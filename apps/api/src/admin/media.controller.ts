import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { InstagramImageService } from '../postiz/instagram-image.service';

const previewSchema = z.object({ url: z.string().url() });

@Controller('media')
@UseGuards(AdminKeyGuard)
export class MediaController {
  constructor(private readonly instagramImages: InstagramImageService) {}

  @Post('instagram-preview')
  async instagramPreview(@Body() body: unknown) {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('请输入有效的 http(s) 图片 URL');
    return this.instagramImages.createPreview(parsed.data.url);
  }
}
