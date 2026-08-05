import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp, { Metadata } from 'sharp';

interface InstagramVariant {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
}

@Injectable()
export class InstagramImageService {
  private static readonly MAX_SOURCE_BYTES = 20 * 1024 * 1024;

  async createPublishVariant(url: string): Promise<InstagramVariant> {
    const input = await this.download(url);
    return this.transform(input, 1080, 1350, 88);
  }

  async createPreview(url: string) {
    const input = await this.download(url);
    const variant = await this.transform(input, 540, 675, 80);
    return {
      dataUrl: `data:image/jpeg;base64,${variant.buffer.toString('base64')}`,
      width: variant.width,
      height: variant.height,
      originalWidth: variant.originalWidth,
      originalHeight: variant.originalHeight,
    };
  }

  private async download(url: string): Promise<Buffer> {
    await this.assertPublicHttpUrl(url);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new BadRequestException('图片下载失败或超时');
    }
    if (!response.ok)
      throw new BadRequestException(`图片下载失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      throw new BadRequestException('URL 返回的不是图片');
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > InstagramImageService.MAX_SOURCE_BYTES) {
      throw new BadRequestException('图片超过 20 MB，无法处理');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (
      !buffer.length ||
      buffer.length > InstagramImageService.MAX_SOURCE_BYTES
    ) {
      throw new BadRequestException('图片为空或超过 20 MB');
    }
    return buffer;
  }

  private async assertPublicHttpUrl(value: string) {
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

    let addresses: Array<{ address: string }>;
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new BadRequestException('图片域名无法解析');
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => this.isPrivateAddress(address))
    ) {
      throw new BadRequestException('不允许访问本机或私网地址');
    }
  }

  private isPrivateAddress(address: string) {
    if (isIP(address) === 6) {
      const normalized = address.toLowerCase();
      return (
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
      );
    }

    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  private async transform(
    input: Buffer,
    width: number,
    height: number,
    quality: number,
  ): Promise<InstagramVariant> {
    let metadata: Metadata;
    try {
      metadata = await sharp(input, { failOn: 'warning' }).metadata();
    } catch {
      throw new BadRequestException('无法识别图片格式');
    }

    const background = await sharp(input)
      .rotate()
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .blur(Math.max(18, Math.round(width / 24)))
      .modulate({ brightness: 0.52, saturation: 0.72 })
      .jpeg({ quality })
      .toBuffer();

    const foreground = await sharp(input)
      .rotate()
      .resize(width, height, {
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const buffer = await sharp(background)
      .composite([{ input: foreground, blend: 'over' }])
      .jpeg({ quality, chromaSubsampling: '4:4:4' })
      .toBuffer();

    return {
      buffer,
      width,
      height,
      originalWidth: metadata.width ?? null,
      originalHeight: metadata.height ?? null,
    };
  }
}
