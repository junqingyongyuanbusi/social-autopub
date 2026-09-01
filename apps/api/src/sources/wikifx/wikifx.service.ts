import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { AccessService } from '../../common/access.service';
import { RequestUser } from '../../common/current-user';
import { IngestService } from '../../ingest/ingest.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  WikifxClient,
  WikifxClientError,
  WikifxClientResult,
  WikifxContentResolved,
  WikifxUpstreamMetadata,
} from './wikifx.client';
import { parseWikiFXArticleUrl } from './wikifx-url';
import {
  WikifxArticle,
  WikifxArticleDetail,
  WikifxTopResponse,
  wikifxArticleDetailSchema,
  wikifxTopResponseSchema,
} from './wikifx.schema';

interface CacheEntry {
  fetchedAt: string;
  data: WikifxTopResponse;
  metadata: WikifxUpstreamMetadata;
}

const FAILED_CONTENT_STATES = new Set([
  'empty',
  'not_found',
  'blocked',
  'timeout',
  'error',
  'fetch_failed',
  'not_fetched',
  'content_not_fetched',
]);

export interface WikifxManualArticle {
  language: string;
  article_id: string;
  title: string;
  url: string | null;
  content: string | null;
  first_image_url: string | null;
  content_status: string | null;
  content_message: string | null;
}

interface TrustedResult extends WikifxClientResult {
  cache: {
    status: 'upstream' | 'local-fresh' | 'local-stale';
    fetched_at: string;
    wikifx_cache: string | null;
    age: string | null;
    request_id: string | null;
  };
}

@Injectable()
export class WikifxService {
  private static readonly FRESH_MS = 60_000;
  private static readonly STALE_MS = 24 * 60 * 60 * 1_000;
  /** 手动抓取结果缓存：采用时从缓存取正文，不重复抓上游 */
  private static readonly MANUAL_TTL_MS = 10 * 60 * 1_000;

  constructor(
    private readonly client: WikifxClient,
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    private readonly access: AccessService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async topics(user: RequestUser, days: number, top: number) {
    const result = await this.trustedFetch(days, top);
    const visibleLanguages = await this.access.visibleLanguages(user);
    const visibleArticles =
      visibleLanguages === null
        ? result.data.items
        : result.data.items.filter((item) =>
            visibleLanguages.includes(item.language),
          );
    // The public ranking endpoint is intentionally separate from article
    // content.  Fill missing bodies from the migrated sidecar, while keeping
    // ranking/cache metadata owned by the trusted top response.
    const articles = await this.enrichTopicContents(visibleArticles);
    const adoptions = await this.findAdoptions(articles);

    return {
      statistics_start: result.data.statistics_start,
      statistics_end: result.data.statistics_end,
      days: result.data.days,
      top: result.data.top,
      property_id: result.data.property_id,
      data_quality: result.data.data_quality,
      cache: result.cache,
      items: articles.map((article) => {
        const externalId = this.externalId(article);
        return {
          ...this.normalizeArticle(article),
          adoption: adoptions.get(externalId) ?? null,
        };
      }),
    };
  }

  async adopt(
    user: RequestUser,
    input: { article_id: string; language: string; days?: number; manual?: boolean },
  ) {
    await this.access.assertPermission(user, input.language, 'canEdit');

    let article: WikifxArticle | null = null;
    if (input.manual) {
      const manual = await this.readManualCache(input.language, input.article_id);
      if (manual) {
        article = this.manualToArticle(manual);
      }
    } else {
      const result = await this.trustedFetch(input.days ?? 3, 1);
      const candidates = result.data.items.filter(
        (item) =>
          item.article_id === input.article_id &&
          item.language === input.language,
      );
      const articles = await this.enrichTopicContents(candidates);
      article = articles[0] ?? null;
    }
    if (!article) {
      throw new ConflictException(
        input.manual
          ? 'WikiFX 手动抓取结果已过期，请先重新抓取'
          : 'WikiFX article is not present in the trusted topic result',
      );
    }

    const body = article.content?.trim();
    if (!body || this.isFailedContentState(article.content_status)) {
      throw new UnprocessableEntityException(
        'WikiFX article content is unavailable',
      );
    }

    const mediaUrl = this.httpUrl(article.first_image_url);
    const item = await this.ingest.upsert(
      'wikifx',
      {
        external_id: this.externalId(article),
        language: article.language,
        content_type: 'news',
        title: article.article_title,
        body,
        media: mediaUrl ? [mediaUrl] : [],
        target_platforms: [],
      },
      {
        rawPayload: {
          source: 'wikifx',
          article,
          adopted_via: input.manual ? 'manual' : 'topic',
        },
      },
    );
    return {
      content_item_id: item.id,
      status: item.status,
      created_at: item.createdAt.toISOString(),
    };
  }

  /**
   * 按受控 URL 手动抓取单篇正文。先读库（force=false），正文缺失或抓取失败
   * 时按 force 决定是否触发上游强制抓取；结果短期缓存供采用时复用。
   */
  async fetchByUrl(user: RequestUser, url: string, force: boolean) {
    const target = parseWikiFXArticleUrl(url);
    await this.access.assertPermission(user, target.language, 'canEdit');

    const cached = await this.readManualCache(target.language, target.articleId);
    if (!force && cached) {
      return this.manualResponse(cached, 'cache');
    }

    let detail: WikifxArticleDetail | null = null;
    let status = 0;
    try {
      const result = await this.client.fetchArticle(
        target.language,
        target.articleId,
        { force },
      );
      status = result.status;
      const parsed = wikifxArticleDetailSchema.safeParse(result.data);
      if (parsed.success) {
        detail = parsed.data;
      }
    } catch (error) {
      if (error instanceof WikifxClientError && error.kind === 'config') {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof WikifxClientError && error.kind === 'timeout') {
        throw new GatewayTimeoutException(error.message);
      }
      if (
        error instanceof WikifxClientError &&
        (error.status === 401 || error.status === 503)
      ) {
        throw new ServiceUnavailableException('WikiFX 正文服务暂不可用');
      }
      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'WikiFX 单篇正文读取失败',
      );
    }

    if (!detail || status !== 200) {
      throw new UnprocessableEntityException(
        this.detailFailureMessage(status, detail),
      );
    }
    if (
      detail.language !== target.language ||
      detail.article_id !== target.articleId
    ) {
      throw new BadGatewayException(
        'WikiFX article content service returned a mismatched article',
      );
    }
    // The sidecar preserves an old body for diagnostics when a later attempt
    // fails.  It must not be treated as a successful fresh result solely
    // because the JSON still contains `content`.
    if (detail.status && detail.status !== 'ok') {
      throw new UnprocessableEntityException(
        this.detailFailureMessage(status, detail),
      );
    }
    const content = detail.content?.trim() ?? '';
    if (!content) {
      throw new UnprocessableEntityException(
        force
          ? this.detailFailureMessage(status, detail)
          : '正文尚未抓取，请选择“强制抓取”后再试',
      );
    }
    const title = detail.title?.trim() || `WikiFX 文章 ${detail.article_id}`;
    const manual: WikifxManualArticle = {
      language: detail.language || target.language,
      article_id: detail.article_id || target.articleId,
      title,
      url: this.httpUrl(detail.url) ?? target.canonicalUrl,
      content,
      first_image_url: this.httpUrl(detail.first_image_url),
      content_status: detail.status ?? null,
      content_message: detail.error_code ?? null,
    };
    await this.writeManualCache(manual);
    return this.manualResponse(manual, 'upstream');
  }

  private async enrichTopicContents(
    articles: WikifxArticle[],
  ): Promise<WikifxArticle[]> {
    const missing = articles.filter(
      (article) =>
        !this.hasUsableTopicContent(article) ||
        !article.first_image_url?.trim(),
    );
    if (!missing.length) return articles;

    // Keep compatibility with lightweight test doubles and older callers while
    // the sidecar rollout is staged.  Production always uses the real method.
    if (typeof this.client.resolveArticles !== 'function') return articles;

    let resolved: WikifxContentResolved[];
    try {
      resolved = await this.client.resolveArticles(
        missing.map((article) => ({
          language: article.language,
          article_id: article.article_id,
          article_url: article.article_url,
        })),
      );
    } catch (error) {
      const message = this.contentServiceFailureMessage(error);
      return articles.map((article) =>
        this.hasUsableTopicContent(article)
          ? article
          : {
              ...article,
              content_status: 'fetch_failed',
              content_message: message,
            },
      );
    }

    const byKey = new Map(
      resolved.map((row) => [`${row.language}:${row.article_id}`, row]),
    );
    return articles.flatMap((article) => {
      const row = byKey.get(`${article.language}:${article.article_id}`);
      if (!row) return [article];

      // A confirmed upstream 404 is not a usable topic.  Other failures remain
      // visible with their structured state so operators can distinguish an
      // empty extraction, a block, a timeout, and a missing article.
      if (row.status === 'not_found' || row.error_code === 'not_found') {
        return [];
      }
      return [
        {
          ...article,
          article_title: row.title?.trim() || article.article_title,
          article_url: row.url || article.article_url,
          content: row.content ?? null,
          first_image_url: row.first_image_url ?? article.first_image_url,
          content_status:
            row.content_status ?? row.status ?? article.content_status ?? null,
          content_message: row.content_message ?? row.error_code ?? null,
        },
      ];
    });
  }

  private hasUsableTopicContent(article: Pick<WikifxArticle, 'content' | 'content_status'>) {
    return Boolean(
      article.content?.trim() &&
        !this.isFailedContentState(article.content_status),
    );
  }

  private isFailedContentState(value: string | null | undefined) {
    return Boolean(value && FAILED_CONTENT_STATES.has(value));
  }

  private contentServiceFailureMessage(error: unknown): string {
    if (error instanceof WikifxClientError) {
      if (error.kind === 'config') return '正文服务未配置';
      if (error.kind === 'timeout') return '正文服务抓取超时，请稍后重试';
    }
    return '正文服务暂不可用，请稍后重试';
  }

  private async trustedFetch(days: number, top: number): Promise<TrustedResult> {
    const cached = await this.readCache(days, top);
    const cachedAge = cached
      ? Date.now() - new Date(cached.fetchedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (cached && cachedAge <= WikifxService.FRESH_MS) {
      return this.fromCache(cached, 'local-fresh');
    }

    try {
      const upstream = await this.client.fetchTop(days, top);
      const fetchedAt = new Date().toISOString();
      await this.writeCache(days, top, {
        fetchedAt,
        data: upstream.data,
        metadata: upstream.metadata,
      });
      return {
        ...upstream,
        cache: this.cacheMetadata('upstream', fetchedAt, upstream.metadata),
      };
    } catch (error) {
      if (
        error instanceof WikifxClientError &&
        error.kind !== 'config' &&
        cached &&
        cachedAge <= WikifxService.STALE_MS
      ) {
        return this.fromCache(cached, 'local-stale');
      }
      this.throwMapped(error);
    }
  }

  private async findAdoptions(articles: WikifxArticle[]) {
    const externalIds = [...new Set(articles.map((item) => this.externalId(item)))];
    if (!externalIds.length) return new Map<string, unknown>();
    const rows = await this.prisma.contentItem.findMany({
      where: {
        source: 'wikifx',
        externalId: { in: externalIds },
        status: { not: 'SUPERSEDED' },
      },
      select: {
        id: true,
        externalId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const result = new Map<string, unknown>();
    for (const row of rows) {
      if (!result.has(row.externalId)) {
        result.set(row.externalId, {
          content_item_id: row.id,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        });
      }
    }
    return result;
  }

  private manualResponse(manual: WikifxManualArticle, origin: 'cache' | 'upstream') {
    return {
      origin,
      article: {
        ...manual,
        id: `${manual.language}:${manual.article_id}`,
      },
      cache_ttl_seconds: Math.floor(WikifxService.MANUAL_TTL_MS / 1_000),
    };
  }

  private manualToArticle(manual: WikifxManualArticle): WikifxArticle {
    return {
      article_id: manual.article_id,
      language: manual.language,
      article_url: manual.url ?? '',
      article_title: manual.title,
      content: manual.content,
      content_status: manual.content_status,
      content_message: manual.content_message,
      first_image_url: manual.first_image_url,
      content_country: null,
      content_region: null,
      view_count: 0,
      active_users: 0,
      avg_engagement_seconds: 0,
      click_count: null,
      read_count: null,
    };
  }

  private detailFailureMessage(status: number, detail: WikifxArticleDetail | null) {
    const state = detail?.status ?? detail?.error_code;
    if (state === 'not_found' || detail?.error_code === 'not_found') {
      return '原文已下架或不存在';
    }
    if (status === 404) return '该文章不在正文库中（可能尚未抓取），请选择“强制抓取”后再试';
    if (state === 'blocked' || detail?.error_code === 'blocked') {
      return '目标站拦截了抓取，请稍后再试';
    }
    if (state === 'timeout' || detail?.error_code === 'timeout') {
      return '抓取上游超时，请稍后重试';
    }
    if (state === 'empty' || detail?.error_code === 'empty_content') {
      return '已抓取页面，但未抽取到正文，请稍后重试或换一篇';
    }
    if (detail?.error_code) return `抓取未成功：${detail.error_code}`;
    return '单篇正文读取失败，请稍后重试';
  }

  private manualCacheKey(language: string, articleId: string) {
    return `wikifx:manual:${language}:${articleId}`;
  }

  private async readManualCache(
    language: string,
    articleId: string,
  ): Promise<WikifxManualArticle | null> {
    const raw = await this.redis.get(this.manualCacheKey(language, articleId)).catch(() => null);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as WikifxManualArticle;
      if (
        !value ||
        value.language !== language ||
        value.article_id !== articleId ||
        !value.content ||
        this.isFailedContentState(value.content_status)
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  private async writeManualCache(manual: WikifxManualArticle) {
    await this.redis
      .set(
        this.manualCacheKey(manual.language, manual.article_id),
        JSON.stringify(manual),
        'EX',
        Math.ceil(WikifxService.MANUAL_TTL_MS / 1_000),
      )
      .catch(() => undefined);
  }

  private normalizeArticle(article: WikifxArticle) {
    return {
      id: this.externalId(article),
      article_id: article.article_id,
      language: article.language,
      title: article.article_title,
      url: this.httpUrl(article.article_url),
      country: article.content_country ?? null,
      region: article.content_region ?? null,
      view_count: article.view_count,
      active_users: article.active_users,
      avg_engagement_seconds: article.avg_engagement_seconds,
      click_count: article.click_count ?? null,
      read_count: article.read_count ?? null,
      content: article.content ?? null,
      content_message: article.content_message ?? null,
      content_status: article.content_status ?? null,
      first_image_url: this.httpUrl(article.first_image_url),
    };
  }

  private externalId(article: Pick<WikifxArticle, 'language' | 'article_id'>) {
    return `${article.language}:${article.article_id}`;
  }

  private httpUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  private cacheKey(days: number, top: number) {
    return `cache:wikifx:topics:days=${days}:top=${top}`;
  }

  private async readCache(days: number, top: number): Promise<CacheEntry | null> {
    const raw = await this.redis.get(this.cacheKey(days, top)).catch(() => null);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as CacheEntry;
      const parsed = wikifxTopResponseSchema.safeParse(value.data);
      const fetchedAt = new Date(value.fetchedAt).getTime();
      if (
        !parsed.success ||
        !Number.isFinite(fetchedAt) ||
        fetchedAt > Date.now() + 60_000 ||
        !value.metadata
      ) {
        return null;
      }
      return { ...value, data: parsed.data };
    } catch {
      return null;
    }
  }

  private async writeCache(days: number, top: number, entry: CacheEntry) {
    await this.redis
      .set(
        this.cacheKey(days, top),
        JSON.stringify(entry),
        'EX',
        Math.ceil(WikifxService.STALE_MS / 1_000),
      )
      .catch(() => undefined);
  }

  private fromCache(
    entry: CacheEntry,
    status: 'local-fresh' | 'local-stale',
  ): TrustedResult {
    return {
      data: entry.data,
      metadata: entry.metadata,
      cache: this.cacheMetadata(status, entry.fetchedAt, entry.metadata),
    };
  }

  private cacheMetadata(
    status: TrustedResult['cache']['status'],
    fetchedAt: string,
    metadata: WikifxUpstreamMetadata,
  ) {
    return {
      status,
      fetched_at: fetchedAt,
      wikifx_cache: metadata.wikifxCache,
      age: metadata.age,
      request_id: metadata.requestId,
    };
  }

  private throwMapped(error: unknown): never {
    if (!(error instanceof WikifxClientError)) {
      throw new BadGatewayException('WikiFX articles API request failed');
    }
    if (error.kind === 'timeout') {
      throw new GatewayTimeoutException(error.message);
    }
    if (error.kind === 'config') {
      throw new ServiceUnavailableException(error.message);
    }
    if (error.status === 429 || error.status === 503) {
      throw new ServiceUnavailableException(error.message);
    }
    if (error.status === 502) {
      throw new BadGatewayException(error.message);
    }
    throw new HttpException(
      {
        statusCode: 502,
        message: error.message,
        upstreamStatus: error.status ?? null,
        requestId: error.requestId ?? null,
      },
      502,
    );
  }
}
