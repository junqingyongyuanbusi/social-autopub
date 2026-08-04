import { Injectable, Logger } from '@nestjs/common';

// Postiz Public API 薄封装。若日后弃用 Postiz，仅需替换此文件实现
// 注意：Postiz 默认限流 30 req/h，自托管可调 API_LIMIT；调用方（publish.processor）已做队列节流
@Injectable()
export class PostizClient {
  private readonly logger = new Logger(PostizClient.name);
  private readonly baseUrl = process.env.POSTIZ_API_URL ?? '';
  private readonly apiKey = process.env.POSTIZ_API_KEY ?? '';

  // 平台默认 settings（Generation.settings 可覆盖）
  private static readonly DEFAULT_SETTINGS: Record<string, object> = {
    x: { __type: 'x', who_can_reply_post: 'everyone', community: '' },
    instagram: { __type: 'instagram', post_type: 'post' },
    facebook: { __type: 'facebook' },
  };

  async getIntegrations(): Promise<Array<{ id: string; name: string; identifier: string; disabled?: boolean }>> {
    return this.request('GET', '/integrations');
  }

  async createPost(input: {
    integrationId: string;
    platform: string;
    content: string;
    mediaUrls: string[];
    publishAt?: Date | null;
    settings?: object | null;
    dryRun: boolean;
  }): Promise<{ postId?: string }> {
    // 外链图片先转存到 Postiz（IG/FB 对外链取图不稳定），失败时降级为直接传 URL
    const images = await Promise.all(
      input.mediaUrls.map(async (url, i) => {
        const uploaded = await this.uploadFromUrl(url).catch(() => null);
        return { id: uploaded?.id ?? `m${i}`, path: uploaded?.path ?? url };
      }),
    );

    const body = {
      type: input.dryRun ? 'draft' : input.publishAt ? 'schedule' : 'now',
      date: (input.publishAt ?? new Date()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: input.integrationId },
          value: [{ content: input.content, image: images }],
          settings: input.settings ?? PostizClient.DEFAULT_SETTINGS[input.platform] ?? { __type: input.platform },
        },
      ],
    };
    const res = await this.request<any>('POST', '/posts', body);
    return { postId: res?.[0]?.postId ?? res?.id };
  }

  // 下载外链媒体并上传到 Postiz，返回其媒体记录
  private async uploadFromUrl(url: string): Promise<{ id: string; path: string }> {
    const download = await fetch(url);
    if (!download.ok) throw new Error(`download ${download.status}`);
    const blob = await download.blob();
    const filename = new URL(url).pathname.split('/').pop() || 'image.jpg';

    const form = new FormData();
    form.append('file', blob, filename);
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: { Authorization: this.apiKey },
      body: form,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    return res.json() as Promise<{ id: string; path: string }>;
  }

  private async request<T>(method: string, path: string, body?: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`postiz ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`postiz ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
}
