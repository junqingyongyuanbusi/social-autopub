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
  WikifxUpstreamMetadata,
} from './wikifx.client';
import {
  WikifxArticle,
  WikifxTopResponse,
  wikifxTopResponseSchema,
} from './wikifx.schema';

interface CacheEntry {
  fetchedAt: string;
  data: WikifxTopResponse;
  metadata: WikifxUpstreamMetadata;
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
    const articles =
      visibleLanguages === null
        ? result.data.items
        : result.data.items.filter((item) =>
            visibleLanguages.includes(item.language),
          );
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
    input: { article_id: string; language: string; days?: number },
  ) {
    await this.access.assertPermission(user, input.language, 'canEdit');
    const result = await this.trustedFetch(input.days ?? 3, 1);
    const article = result.data.items.find(
      (item) =>
        item.article_id === input.article_id && item.language === input.language,
    );
    if (!article) {
      throw new ConflictException(
        'WikiFX article is not present in the trusted topic result',
      );
    }

    const body = article.content?.trim();
    if (!body) {
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
        },
      },
    );
    return {
      content_item_id: item.id,
      status: item.status,
      created_at: item.createdAt.toISOString(),
    };
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
