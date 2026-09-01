import { Injectable, Logger } from '@nestjs/common';
import { parseWikiFXArticleUrl } from './wikifx-url';
import {
  WikifxTopResponse,
  wikifxContentResolveResponseSchema,
  wikifxTopResponseSchema,
} from './wikifx.schema';

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
    this.name = 'WikifxClientError';
  }
}

type RequestResult = { status: number; data: unknown };
type HttpResult = RequestResult & { headers: Headers };
type RequestOptions = {
  apiKey: string;
  timeoutMs: number;
  allowNotFound?: boolean;
  requireJson?: boolean;
  serviceName: string;
};

export interface WikifxContentResolved {
  language: string;
  article_id: string;
  url?: string | null;
  title?: string | null;
  summary?: string | null;
  first_image_url?: string | null;
  content?: string | null;
  content_chars?: number | null;
  published_date?: string | null;
  published_date_source?: string | null;
  extract_method?: string | null;
  status?: string | null;
  http_status?: number | null;
  error_code?: string | null;
  attempt_count?: number | null;
  first_fetched_at?: string | null;
  fetched_at?: string | null;
  succeeded_at?: string | null;
  content_status?: string | null;
  content_message?: string | null;
}

@Injectable()
export class WikifxClient {
  private readonly logger = new Logger(WikifxClient.name);

  private static readonly DEFAULT_TOP_URL =
    'https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top';
  private static readonly TOP_TIMEOUT_MS = 10_000;
  private static readonly CONTENT_READ_TIMEOUT_MS = 10_000;
  // curl_cffi may need up to 30 seconds for the upstream page; leave room for
  // one slow page and keep the explicit force action separate from topic reads.
  private static readonly CONTENT_FETCH_TIMEOUT_MS = 120_000;
  private static readonly RETRY_DELAYS_MS = [500, 1_500];
  private static readonly RETRYABLE_STATUSES = new Set([429, 502, 503]);

  async fetchTop(days: number, top: number): Promise<WikifxClientResult> {
    const url = this.configuredTopUrl();
    url.searchParams.set('days', String(days));
    url.searchParams.set('top', String(top));
    const apiKey = this.topApiKeyValue();
    const result = await this.request(url, { method: 'GET' }, {
      apiKey,
      timeoutMs: WikifxClient.TOP_TIMEOUT_MS,
      requireJson: true,
      serviceName: 'WikiFX articles API',
    });

    if (result.status < 200 || result.status >= 300) {
      throw new WikifxClientError(
        `WikiFX articles API returned ${result.status}`,
        result.status,
      );
    }
    const requestId = result.headers.get('x-request-id');
    const parsed = wikifxTopResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new WikifxClientError(
        'WikiFX articles API returned an invalid response',
        result.status,
        requestId,
        'invalid',
      );
    }
    if (parsed.data.days !== days || parsed.data.top !== top) {
      throw new WikifxClientError(
        'WikiFX articles API returned mismatched query metadata',
        result.status,
        requestId,
        'invalid',
      );
    }

    return {
      data: parsed.data,
      metadata: {
        // Preserve the upstream cache diagnostics for the console metadata panel.
        wikifxCache: result.headers.get('x-wikifx-cache'),
        age:
          result.headers.get('x-wikifx-cache-age') ??
          result.headers.get('age'),
        requestId: result.headers.get('x-request-id'),
      },
    };
  }

  /**
   * Read or force-fetch one article through the internal Python sidecar.
   *
   * The public articles gateway only exposes the ranking endpoint.  Detail
   * requests therefore must never be derived from WIKIFX_ARTICLES_API_URL.
   * force=true calls the sidecar's POST /fetch, then reads the persisted detail.
   */
  async fetchArticle(
    language: string,
    articleId: string,
    options: { force?: boolean } = {},
  ): Promise<RequestResult> {
    const apiKey = this.contentApiKeyValue();
    if (options.force) {
      const trigger = await this.request(
        this.contentArticleUrl(language, articleId, '/fetch'),
        { method: 'POST' },
        {
          apiKey,
          timeoutMs: WikifxClient.CONTENT_FETCH_TIMEOUT_MS,
          allowNotFound: true,
          serviceName: 'WikiFX article content service',
        },
      );
      if (trigger.status < 200 || trigger.status >= 300) {
        return { status: trigger.status, data: trigger.data };
      }
    }

    const result = await this.request(
      this.contentArticleUrl(language, articleId, ''),
      { method: 'GET' },
      {
        apiKey,
        timeoutMs: WikifxClient.CONTENT_READ_TIMEOUT_MS,
        allowNotFound: true,
        serviceName: 'WikiFX article content service',
      },
    );
    return { status: result.status, data: result.data };
  }

  /** Check that the configured sidecar and its fetch dependencies are ready. */
  async checkContentHealth(): Promise<void> {
    const apiKey = this.contentApiKeyValue();
    const result = await this.request(
      this.contentBaseUrl('/healthz'),
      { method: 'GET' },
      {
        apiKey,
        timeoutMs: 3_000,
        serviceName: 'WikiFX article content service',
      },
    );
    const payload = result.data as { ok?: unknown } | null;
    if (result.status < 200 || result.status >= 300 || payload?.ok !== true) {
      throw new WikifxClientError(
        'WikiFX article content service is unhealthy',
        result.status,
        result.headers.get('x-request-id'),
      );
    }
  }

  /**
   * Resolve the content for ranked topic items through the sidecar.  Invalid
   * ranking URLs are skipped rather than forwarded; the caller can still show
   * the trusted ranking row without content enrichment.
   */
  async resolveArticles(
    articles: Array<{
      language: string;
      article_id: string;
      article_url: string;
    }>,
  ): Promise<WikifxContentResolved[]> {
    const items = articles.flatMap((article) => {
      try {
        const target = parseWikiFXArticleUrl(article.article_url);
        if (
          target.language !== article.language ||
          target.articleId !== article.article_id
        ) {
          return [];
        }
        return [
          {
            language: target.language,
            article_id: target.articleId,
            article_url: target.canonicalUrl,
          },
        ];
      } catch {
        return [];
      }
    });
    if (!items.length) return [];

    const apiKey = this.contentApiKeyValue();
    const result = await this.request(
      this.contentBaseUrl('/api/articles/content/resolve'),
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      },
      {
        apiKey,
        timeoutMs: WikifxClient.CONTENT_FETCH_TIMEOUT_MS,
        requireJson: true,
        serviceName: 'WikiFX article content service',
      },
    );
    if (result.status < 200 || result.status >= 300) {
      throw new WikifxClientError(
        `WikiFX article content service returned ${result.status}`,
        result.status,
      );
    }
    const parsed = wikifxContentResolveResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new WikifxClientError(
        'WikiFX article content service returned an invalid response',
        result.status,
        result.headers.get('x-request-id'),
        'invalid',
      );
    }
    return parsed.data.items as WikifxContentResolved[];
  }

  private contentBaseUrl(path: string): URL {
    const base = this.configuredContentUrl();
    const basePath = base.pathname.replace(/\/+$/, '');
    base.pathname = `${basePath}${path}`;
    base.search = '';
    base.hash = '';
    return base;
  }

  private contentArticleUrl(
    language: string,
    articleId: string,
    suffix: string,
  ): URL {
    const base = this.configuredContentUrl();
    const basePath = base.pathname.replace(/\/+$/, '');
    base.pathname = `${basePath}/api/articles/content/${encodeURIComponent(language)}/${encodeURIComponent(articleId)}${suffix}`;
    base.search = '';
    base.hash = '';
    return base;
  }

  private topApiKeyValue(): string {
    const apiKey = process.env.WIKIFX_ARTICLES_API_KEY?.trim();
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

  private contentApiKeyValue(): string {
    const apiKey = process.env.WIKIFX_CONTENT_API_KEY?.trim();
    if (!apiKey) {
      throw new WikifxClientError(
        'WikiFX article content service is not configured',
        undefined,
        null,
        'config',
      );
    }
    return apiKey;
  }

  private configuredTopUrl(): URL {
    this.topApiKeyValue();
    const raw =
      process.env.WIKIFX_ARTICLES_API_URL ?? WikifxClient.DEFAULT_TOP_URL;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new WikifxClientError(
        'WikiFX articles API URL is not allowed',
        undefined,
        null,
        'config',
      );
    }
    const allowCustomUrl = process.env.WIKIFX_ALLOW_CUSTOM_URL === 'true';
    // 开发/内网环境显式放行 http；生产默认仍强制 https。
    const allowInsecureHttp = process.env.WIKIFX_ALLOW_INSECURE_HTTP === 'true';
    if (
      (allowInsecureHttp
        ? !['http:', 'https:'].includes(url.protocol)
        : url.protocol !== 'https:') ||
      (!allowCustomUrl && url.hostname !== 'articles-api.chouai.cc.cd') ||
      url.username ||
      url.password
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

  private configuredContentUrl(): URL {
    const raw = process.env.WIKIFX_CONTENT_API_URL?.trim();
    if (!raw) {
      throw new WikifxClientError(
        'WikiFX article content service is not configured',
        undefined,
        null,
        'config',
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new WikifxClientError(
        'WikiFX article content service URL is not allowed',
        undefined,
        null,
        'config',
      );
    }
    const allowInsecureHttp =
      process.env.WIKIFX_CONTENT_ALLOW_INSECURE_HTTP === 'true';
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !allowInsecureHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.hostname
    ) {
      throw new WikifxClientError(
        'WikiFX article content service URL is not allowed',
        undefined,
        null,
        'config',
      );
    }
    return url;
  }

  private async request(
    url: URL,
    init: { method: string; body?: string },
    options: RequestOptions,
  ): Promise<HttpResult> {
    const deadline = Date.now() + options.timeoutMs;
    for (
      let attempt = 0;
      attempt <= WikifxClient.RETRY_DELAYS_MS.length;
      attempt++
    ) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new WikifxClientError(
          `${options.serviceName} timed out`,
          undefined,
          null,
          'timeout',
        );
      }

      let response: Response;
      try {
        const requestInit: RequestInit = {
          method: init.method,
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: AbortSignal.timeout(remaining),
        };
        if (init.body !== undefined) requestInit.body = init.body;
        response = await fetch(url, requestInit);
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        const message = timedOut
          ? `${options.serviceName} timed out`
          : `${options.serviceName} request failed`;
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
      if (response.ok || (response.status === 404 && options.allowNotFound)) {
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          if (options.requireJson) {
            const message = `${options.serviceName} returned invalid JSON`;
            this.logFailure(response.status, requestId, message);
            throw new WikifxClientError(
              message,
              response.status,
              requestId,
              'invalid',
            );
          }
          // A body-less 404 (or an empty detail response) can be handled by the
          // caller as a structured missing/empty state.
        }
        return { status: response.status, data, headers: response.headers };
      }

      const message = `${options.serviceName} returned ${response.status}`;
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
    throw new WikifxClientError(`${options.serviceName} request failed`);
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, 5_000);
      }
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) {
        return Math.min(Math.max(at - Date.now(), 0), 5_000);
      }
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
