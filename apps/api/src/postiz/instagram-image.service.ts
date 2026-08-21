import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaDownloadService } from '../common/media-download.service';
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
  constructor(private readonly mediaDownloads: MediaDownloadService) {}

  async downloadPublicImage(url: string): Promise<Buffer> {
    return this.mediaDownloads.downloadPublicImage(url);
  }

  async assertPublicImageUrl(url: string): Promise<void> {
    await this.mediaDownloads.assertPublicImageUrl(url);
  }

  async createPublishVariant(url: string): Promise<InstagramVariant> {
    const input = await this.mediaDownloads.downloadPublicImage(url);
    return this.transform(input, 1080, 1350, 88);
  }

  async createPublishVariantFromBuffer(buffer: Buffer): Promise<InstagramVariant> {
    return this.transform(buffer, 1080, 1350, 88);
  }

  async createPreview(url: string) {
    const input = await this.mediaDownloads.downloadPublicImage(url);
    const variant = await this.transform(input, 540, 675, 80);
    return {
      dataUrl: `data:image/jpeg;base64,${variant.buffer.toString('base64')}`,
      width: variant.width,
      height: variant.height,
      originalWidth: variant.originalWidth,
      originalHeight: variant.originalHeight,
    };
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
