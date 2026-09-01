import { Injectable, Logger } from '@nestjs/common';
import { WikifxTopResponse, wikifxTopResponseSchema } from './wikifx.schema';

export interface WikifxUpstreamMetadata {
  wikifxCache: string | null;
  age: string | null;
  requestId: string | null;
}

export interface WikifxClientResult {
  data: WikifxTopResponse;
  metadata: WikifxUpstreamMetadata;
}

export class WikifxClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string | null,
    readonly kind: 'http' | 'timeout' | 'network' | 'invalid' | 'config' = 'http',
  ) {
    super(message);
  }
}

@Injectable()
export class WikifxClient {
  private readonly logger = new Logger(WikifxClient.name);
  private static readonly DEFAULT_URL =
    'https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top';
  private static readonly TOTAL_TIMEOUT_MS = 10_000;
  private static readonly RETRY_DELAYS_MS = [500, 1_500];
  private static readonly RETRYABLE_STATUSES = new Set([429, 502, 503]);

  async fetchTop(days: number, top: number): Promise<WikifxClientResult> {
    const url = this.configuredUrl();
    url.searchParams.set('days', String(days));
    url.searchParams.set('top', String(top));
    const apiKey = this.apiKeyValue();
    const deadline = Date.now() + WikifxClient.TOTAL_TIMEOUT_MS;
    for (let attempt = 0; attempt <= WikifxClient.RETRY_DELAYS_MS.length; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new WikifxClientError(
          'WikiFX articles API timed out',
          undefined,
          null,
          'timeout',
        );
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(remaining),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        const message = timedOut
          ? 'WikiFX articles API timed out'
          : 'WikiFX articles API request failed';
        this.logFailure(undefined, null, message);
        if (attempt < WikifxClient.RETRY_DELAYS_MS.length) {
          const delay = WikifxClient.RETRY_DELAYS_MS[attempt];
          if (Date.now() + delay < deadline) {
            await this.sleep(delay);
            continue;
          }
        }
        throw new WikifxClientError(
          message,
          undefined,
          null,
          timedOut ? 'timeout' : 'network',
        );
      }

      const requestId = response.headers.get('x-request-id');
      if (response.ok) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          const message = 'WikiFX articles API returned invalid JSON';
          this.logFailure(response.status, requestId, message);
          throw new WikifxClientError(
            message,
            response.status,
            requestId,
            'invalid',
          );
        }
        const parsed = wikifxTopResponseSchema.safeParse(json);
        if (!parsed.success) {
          const message = 'WikiFX articles API returned an invalid response';
          this.logFailure(response.status, requestId, message);
          throw new WikifxClientError(
            message,
            response.status,
            requestId,
            'invalid',
          );
        }
        if (parsed.data.days !== days || parsed.data.top !== top) {
          const message = 'WikiFX articles API returned mismatched query metadata';
          this.logFailure(response.status, requestId, message);
          throw new WikifxClientError(
            message,
            response.status,
            requestId,
            'invalid',
          );
        }
        return {
          data: parsed.data,
          metadata: {
            wikifxCache: response.headers.get('x-wikifx-cache'),
            age:
              response.headers.get('x-wikifx-cache-age') ??
              response.headers.get('age'),
            requestId,
          },
        };
      }

      const message = `WikiFX articles API returned ${response.status}`;
      this.logFailure(response.status, requestId, message);
      if (
        WikifxClient.RETRYABLE_STATUSES.has(response.status) &&
        attempt < WikifxClient.RETRY_DELAYS_MS.length
      ) {
        const delay = this.retryDelay(response, attempt);
        if (Date.now() + delay < deadline) {
          await this.sleep(delay);
          continue;
        }
      }
      throw new WikifxClientError(message, response.status, requestId);
    }

    throw new WikifxClientError('WikiFX articles API request failed');
  }

  /**
   * 单篇正文：GET 读库优先（未抓取回 404），force=true 时先 POST /fetch 触发
   * 抓取再 GET。只接受白名单 language/article_id（调用方已校验）。
   */
  async fetchArticle(
    language: string,
    articleId: string,
    options: { force?: boolean } = {},
  ): Promise<{ status: number; data: unknown }> {
    if (options.force) {
      const fetchUrl = this.articleUrl(language, articleId, '/fetch');
      const fetchResult = await this.request(fetchUrl, { method: 'POST' });
      if (fetchResult.status < 200 || fetchResult.status >= 300) {
        return { status: fetchResult.status, data: null };
      }
    }
    const url = this.articleUrl(language, articleId, '');
    const result = await this.request(url, { method: 'GET' });
    return { status: result.status, data: result.data };
  }

  private articleUrl(
    language: string,
    articleId: string,
    suffix: string,
  ): URL {
    const base = this.configuredUrl();
    base.pathname = base.pathname.replace(/\/articles\/top$/, '');
    base.pathname = `${base.pathname}/articles/content/${language}/${articleId}${suffix}`;
    base.search = '';
    return base;
  }

  private apiKeyValue(): string {
    const apiKey = process.env.WIKIFX_ARTICLES_API_KEY;
    if (!apiKey) {
      throw new WikifxClientError(
        'WikiFX articles API is not configured',
        undefined,
        null,
        'config',
      );
    }
    return apiKey;
  }

  private configuredUrl(): URL {
    this.apiKeyValue();
    const url = new URL(
      process.env.WIKIFX_ARTICLES_API_URL ?? WikifxClient.DEFAULT_URL,
    );
    const allowCustomUrl = process.env.WIKIFX_ALLOW_CUSTOM_URL === 'true';
    // 开发/内网环境显式放行 http（默认仍强制 https，生产安全不变）。
    const allowInsecureHttp = process.env.WIKIFX_ALLOW_INSECURE_HTTP === 'true';
    if (
      (allowInsecureHttp ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:') ||
      (!allowCustomUrl && url.hostname !== 'articles-api.chouai.cc.cd')
    ) {
      throw new WikifxClientError(
        'WikiFX articles API URL is not allowed',
        undefined,
        null,
        'config',
      );
    }
    return url;
  }

  private async request(
    url: URL,
    init: { method: string },
  ): Promise<{ status: number; data: unknown }> {
    const apiKey = process.env.WIKIFX_ARTICLES_API_KEY ?? '';
    const deadline = Date.now() + WikifxClient.TOTAL_TIMEOUT_MS;
    for (let attempt = 0; attempt <= WikifxClient.RETRY_DELAYS_MS.length; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new WikifxClientError(
          'WikiFX articles API timed out',
          undefined,
          null,
          'timeout',
        );
      }
      let response: Response;
      try {
        response = await fetch(url, {
          method: init.method,
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(remaining),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        const message = timedOut
          ? 'WikiFX articles API timed out'
          : 'WikiFX articles API request failed';
        this.logFailure(undefined, null, message);
        if (attempt < WikifxClient.RETRY_DELAYS_MS.length) {
          const delay = WikifxClient.RETRY_DELAYS_MS[attempt];
          if (Date.now() + delay < deadline) {
            await this.sleep(delay);
            continue;
          }
        }
        throw new WikifxClientError(
          message,
          undefined,
          null,
          timedOut ? 'timeout' : 'network',
        );
      }
      const requestId = response.headers.get('x-request-id');
      if (response.ok) {
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          // 无 body 时保持 null
        }
        return { status: response.status, data };
      }
      const message = `WikiFX articles API returned ${response.status}`;
      this.logFailure(response.status, requestId, message);
      if (
        WikifxClient.RETRYABLE_STATUSES.has(response.status) &&
        attempt < WikifxClient.RETRY_DELAYS_MS.length
      ) {
        const delay = this.retryDelay(response, attempt);
        if (Date.now() + delay < deadline) {
          await this.sleep(delay);
          continue;
        }
      }
      throw new WikifxClientError(message, response.status, requestId);
    }
    throw new WikifxClientError('WikiFX articles API request failed');
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, 5_000);
      }
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 5_000);
    }
    return WikifxClient.RETRY_DELAYS_MS[attempt];
  }


  private logFailure(
    status: number | undefined,
    requestId: string | null,
    message: string,
  ) {
    this.logger.warn(
      `wikifx upstream status=${status ?? 'none'} request_id=${requestId ?? 'none'} message=${message}`,
    );
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
