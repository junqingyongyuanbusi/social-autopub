import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import sharp from 'sharp';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { InstagramImageService } from '../postiz/instagram-image.service';
import { PostizClient } from '../postiz/postiz.client';

// 刻意不引入 @types/multer：只声明实际用到的字段，避免新增依赖
interface UploadedImageFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const previewSchema = z.object({ url: z.string().url() });

// 上传槽位：4:5 给 Instagram，16:9 给 Facebook 与 X
const uploadSchema = z.object({
  slot: z.enum(['instagram_4x5', 'landscape_16x9']),
});

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// 业务上限对齐 Instagram 单图 8MB；multer 另设更宽硬上限，仅用于避免超大文件占满内存
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MULTER_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

@Controller('media')
@UseGuards(AdminKeyGuard)
export class MediaController {
  constructor(
    private readonly instagramImages: InstagramImageService,
    private readonly postiz: PostizClient,
  ) {}

  @Post('instagram-preview')
  async instagramPreview(@Body() body: unknown) {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('请输入有效的 http(s) 图片 URL');
    return this.instagramImages.createPreview(parsed.data.url);
  }

  // 手动撰写页上传配图：4:5 槽位转成 Instagram 合规的 1080x1350，16:9 槽位原样上传
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTER_HARD_LIMIT_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body() body: { slot?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传的图片');
    }
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'slot 必须是 instagram_4x5 或 landscape_16x9',
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG / PNG / WebP 图片');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('图片超过 8MB 上限，请压缩后重试');
    }

    if (parsed.data.slot === 'instagram_4x5') {
      const variant =
        await this.instagramImages.createPublishVariantFromBuffer(file.buffer);
      const uploaded = await this.postiz.uploadMedia({
        buffer: variant.buffer,
        filename: 'instagram-4x5.jpg',
        contentType: 'image/jpeg',
      });
      return {
        ...uploaded,
        slot: parsed.data.slot,
        width: variant.width,
        height: variant.height,
        sourceWidth: variant.originalWidth,
        sourceHeight: variant.originalHeight,
      };
    }

    const metadata = await this.readImageMetadata(file.buffer);
    const uploaded = await this.postiz.uploadMedia({
      buffer: file.buffer,
      filename: this.safeFilename(file.originalname),
      contentType: file.mimetype,
    });
    return {
      ...uploaded,
      slot: parsed.data.slot,
      width: metadata.width,
      height: metadata.height,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
    };
  }

  // 读取真实宽高供前端提示比例；损坏或非图片内容直接拒绝
  private async readImageMetadata(buffer: Buffer) {
    try {
      const metadata = await sharp(buffer, { failOn: 'warning' }).metadata();
      if (!metadata.width || !metadata.height) {
        throw new BadRequestException('无法识别图片尺寸');
      }
      return { width: metadata.width, height: metadata.height };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('无法识别图片格式');
    }
  }

  private safeFilename(value: string): string {
    const base = value.split(/[\\/]/).pop()?.trim();
    return base && base.length ? base : 'upload.jpg';
  }
}
