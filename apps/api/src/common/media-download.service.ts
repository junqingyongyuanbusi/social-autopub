import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { withTimeout } from './with-timeout';

interface PublicAddress {
  address: string;
  family: number;
}

export class MediaTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = MediaTransportError.name;
  }
}

@Injectable()
export class MediaDownloadService {
  private static readonly MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  private static readonly MAX_ATTEMPTS_PER_ADDRESS = 2;
  private static readonly MAX_PUBLIC_ADDRESSES = 3;
  private static readonly REQUEST_DEADLINE_MS = 60_000;
  private static readonly BODY_TIMEOUT_MS = 20_000;

  async downloadPublicImage(value: string): Promise<Buffer> {
    let url = this.parseUrl(value);

    for (let redirects = 0; redirects <= 3; redirects++) {
      const result = await this.requestWithRetry(url);
      const status = result.response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = result.response.headers.location;
        result.response.resume();
        if (!location || redirects === 3) {
          throw new BadRequestException('图片重定向无效或次数过多');
        }
        url = this.parseUrl(new URL(location, url).toString());
        continue;
      }
      if (status < 200 || status >= 300) {
        result.response.resume();
        throw new BadRequestException(`图片下载失败：HTTP ${status || 'unknown'}`);
      }
      return result.body;
    }

    throw new BadRequestException('图片重定向无效或次数过多');
  }

  async assertPublicImageUrl(value: string): Promise<void> {
    const url = this.parseUrl(value);
    await this.resolvePublicAddresses(url.hostname);
  }

  private parseUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('图片 URL 无效');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('图片 URL 仅支持 HTTP/HTTPS');
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new BadRequestException('不允许访问本机或私网地址');
    }
    return url;
  }

  private async requestWithRetry(url: URL): Promise<{
    response: IncomingMessage;
    body: Buffer;
  }> {
    const deadline = Date.now() + MediaDownloadService.REQUEST_DEADLINE_MS;
    const addresses = (await this.resolvePublicAddresses(url.hostname, deadline)).slice(
      0,
      MediaDownloadService.MAX_PUBLIC_ADDRESSES,
    );
    let lastError: unknown;

    outer:
    for (const address of addresses) {
      for (
        let attempt = 0;
        attempt < MediaDownloadService.MAX_ATTEMPTS_PER_ADDRESS;
        attempt++
      ) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break outer;
        try {
          const response = await this.requestToAddress(
            url,
            address,
            Math.min(20_000, remaining),
          );
          const status = response.statusCode ?? 0;

          if (status >= 300 && status < 400) {
            return { response, body: Buffer.alloc(0) };
          }
          if (status >= 400 && status < 500) {
            return { response, body: Buffer.alloc(0) };
          }
          if (status >= 500) {
            response.resume();
            throw new MediaTransportError(`upstream HTTP ${status}`);
          }

          const contentType = response.headers['content-type'];
          if (typeof contentType !== 'string' || !contentType.startsWith('image/')) {
            response.resume();
            throw new BadRequestException('URL 返回的不是图片');
          }
          const contentLength = Number(response.headers['content-length'] ?? 0);
          if (contentLength > MediaDownloadService.MAX_SOURCE_BYTES) {
            response.resume();
            throw new BadRequestException('图片超过 20 MB，无法处理');
          }

          return {
            response,
            body: await this.readBounded(
              response,
              Math.min(
                MediaDownloadService.BODY_TIMEOUT_MS,
                Math.max(1, deadline - Date.now()),
              ),
            ),
          };
        } catch (error) {
          lastError = error;
          if (!(error instanceof MediaTransportError)) throw error;
          if (attempt + 1 < MediaDownloadService.MAX_ATTEMPTS_PER_ADDRESS) {
            const delay = Math.min(
              250 * 2 ** attempt,
              Math.max(0, deadline - Date.now()),
            );
            if (delay > 0) await this.delay(delay);
          }
        }
      }
    }

    throw new BadRequestException(
      `图片下载失败或超时（${url.hostname}）：${(lastError as Error)?.message ?? 'unknown error'}`,
    );
  }

  private async requestToAddress(
    url: URL,
    address: PublicAddress,
    timeoutMs: number,
  ): Promise<IncomingMessage> {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const options: Record<string, unknown> = {
      protocol: url.protocol,
      hostname: address.address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: url.host },
    };
    if (url.protocol === 'https:') options.servername = url.hostname;

    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(options as any, resolve);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new MediaTransportError('connection timeout'));
      });
      req.on('error', (error) => {
        reject(new MediaTransportError(error.message));
      });
      req.end();
    });
  }

  private async resolvePublicAddresses(
    hostname: string,
    deadline = Date.now() + MediaDownloadService.REQUEST_DEADLINE_MS,
  ): Promise<PublicAddress[]> {
    let addresses: PublicAddress[];
    try {
      addresses = await withTimeout(
        lookup(hostname, { all: true }),
        Math.max(1, deadline - Date.now()),
      );
    } catch {
      throw new BadRequestException('图片域名无法解析或解析超时');
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => this.isPrivateAddress(address))
    ) {
      throw new BadRequestException('不允许访问本机或私网地址');
    }
    return addresses.slice(0, MediaDownloadService.MAX_PUBLIC_ADDRESSES);
  }

  private async readBounded(
    response: IncomingMessage,
    timeoutMs: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    let timer: NodeJS.Timeout | undefined;
    const bodyPromise = (async () => {
      try {
        for await (const value of response) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          total += chunk.length;
          if (total > MediaDownloadService.MAX_SOURCE_BYTES) {
            response.destroy();
            throw new BadRequestException('图片超过 20 MB，无法处理');
          }
          chunks.push(chunk);
        }
        return Buffer.concat(chunks, total);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new MediaTransportError(
          error instanceof Error ? error.message : 'response body read failed',
        );
      }
    })();
    void bodyPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        response.destroy();
        reject(new MediaTransportError('response body timeout'));
      }, timeoutMs);
    });

    try {
      return await Promise.race([bodyPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isPrivateAddress(address: string): boolean {
    if (isIP(address) === 6) {
      const normalized = address.toLowerCase();
      if (normalized.startsWith('::ffff:')) {
        return this.isPrivateAddress(normalized.slice('::ffff:'.length));
      }
      const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
      return (
        normalized === '::' ||
        normalized === '::1' ||
        (first & 0xfe00) === 0xfc00 ||
        (first & 0xffc0) === 0xfe80 ||
        (first & 0xff00) === 0xff00 ||
        normalized.startsWith('2001:db8:') ||
        normalized.startsWith('100:')
      );
    }

    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
    const [a, b, c] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
}
