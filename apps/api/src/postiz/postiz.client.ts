import { Injectable, Logger } from '@nestjs/common';
import { InstagramImageService } from './instagram-image.service';
import { PostizRateGate } from './postiz-rate-gate.service';

export interface PreparedPostizMedia {
  id: string;
  path: string;
}

export interface PostizMediaInput {
  url: string;
  buffer?: Buffer;
}

export class PostizOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = PostizOutcomeUnknownError.name;
  }
}

// Postiz Public API 薄封装。若日后弃用 Postiz，仅需替换此文件实现
// 注意：Postiz 默认限流 30 req/h，自托管可调 API_LIMIT；调用方（publish.processor）已做队列节流
@Injectable()
export class PostizClient {
  private readonly logger = new Logger(PostizClient.name);
  private readonly baseUrl = process.env.POSTIZ_API_URL ?? '';
  private readonly apiKey = process.env.POSTIZ_API_KEY ?? '';
  // API 调用与媒体上传的时间上限，避免 worker 无限挂起
  private static readonly API_TIMEOUT_MS = 60_000;
  private static readonly UPLOAD_TIMEOUT_MS = 120_000;

  constructor(
    private readonly instagramImages: InstagramImageService,
    private readonly rateGate: PostizRateGate,
  ) {}

  acquireRequestBudget() {
    return this.rateGate.acquire();
  }

  // 平台默认 settings（Generation.settings 可覆盖）
  private static readonly DEFAULT_SETTINGS: Record<string, object> = {
    x: { __type: 'x', who_can_reply_post: 'everyone', community: '' },
    instagram: { __type: 'instagram', post_type: 'post' },
    facebook: { __type: 'facebook' },
  };

  async getIntegrations(): Promise<
    Array<{ id: string; name: string; identifier: string; disabled?: boolean }>
  > {
    return this.request('GET', '/integrations');
  }

  async prepareMedia(
    platform: string,
    media: Array<string | PostizMediaInput>,
  ): Promise<PreparedPostizMedia[]> {
    return Promise.all(
      media.map(async (value, i) => {
        const source = typeof value === 'string' ? { url: value } : value;
        const filename = new URL(source.url).pathname.split('/').pop() || 'image.jpg';
        if (platform === 'instagram') {
          const variant = source.buffer
            ? await this.instagramImages.createPublishVariantFromBuffer(source.buffer)
            : await this.instagramImages.createPublishVariant(source.url);
          return this.uploadBuffer(
            variant.buffer,
            `instagram-${i + 1}.jpg`,
            'image/jpeg',
          );
        }
        if (source.buffer) {
          return this.uploadBuffer(
            source.buffer,
            filename,
            this.imageContentType(filename),
          );
        }
        return this.uploadFromUrl(source.url);
      }),
    );
  }

  async createPost(input: {
    integrationId: string;
    platform: string;
    content: string;
    mediaUrls?: string[];
    preparedMedia?: PreparedPostizMedia[];
    publishAt?: Date | null;
    settings?: object | null;
    dryRun: boolean;
    requestBudgetAcquired?: boolean;
  }): Promise<{ postId?: string }> {
    const images =
      input.preparedMedia ??
      (await this.prepareMedia(input.platform, input.mediaUrls ?? []));
    const body = {
      type: input.dryRun ? 'draft' : input.publishAt ? 'schedule' : 'now',
      date: (input.publishAt ?? new Date()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: input.integrationId },
          value: [{ content: input.content, image: images }],
          settings: input.settings ??
            PostizClient.DEFAULT_SETTINGS[input.platform] ?? {
              __type: input.platform,
            },
        },
      ],
    };
    const res = await this.request<any>(
      'POST',
      '/posts',
      body,
      true,
      input.requestBudgetAcquired === true,
    );
    return { postId: res?.[0]?.postId ?? res?.id };
  }

  private async uploadBuffer(
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<{ id: string; path: string }> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: contentType }),
      filename,
    );
    await this.rateGate.acquire();
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: { Authorization: this.apiKey },
      body: form,
      signal: AbortSignal.timeout(PostizClient.UPLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`instagram media upload ${res.status}`);
    return res.json() as Promise<{ id: string; path: string }>;
  }

  // 下载外链媒体并上传到 Postiz，返回其媒体记录
  private async uploadFromUrl(
    url: string,
  ): Promise<{ id: string; path: string }> {
    const buffer = await this.instagramImages.downloadPublicImage(url);
    const filename = new URL(url).pathname.split('/').pop() || 'image.jpg';
    const contentType = this.imageContentType(filename);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: contentType }),
      filename,
    );
    await this.rateGate.acquire();
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: { Authorization: this.apiKey },
      body: form,
      signal: AbortSignal.timeout(PostizClient.UPLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    return res.json() as Promise<{ id: string; path: string }>;
  }

  private imageContentType(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object,
    outcomeSensitive = false,
    requestBudgetAcquired = false,
  ): Promise<T> {
    if (!requestBudgetAcquired) await this.rateGate.acquire();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(PostizClient.API_TIMEOUT_MS),
      });
    } catch (error) {
      if (outcomeSensitive) {
        throw new PostizOutcomeUnknownError(
          `Postiz 可能已受理请求，但客户端未收到响应：${(error as Error).message}`,
        );
      }
      throw error;
    }
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(
        `postiz ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`,
      );
      if (outcomeSensitive && res.status >= 500) {
        throw new PostizOutcomeUnknownError(
          `Postiz 返回 ${res.status}，发送结果未知，需要人工对账`,
        );
      }
      throw new Error(`postiz ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch (error) {
      if (outcomeSensitive) {
        throw new PostizOutcomeUnknownError(
          `Postiz 已返回成功响应但结果无法解析：${(error as Error).message}`,
        );
      }
      throw error;
    }
  }
}
