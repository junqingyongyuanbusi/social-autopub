import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AdminKeyGuard } from '../../common/admin-key.guard';
import { CurrentUser, RequestUser } from '../../common/current-user';
import {
  wikifxAdoptSchema,
  wikifxFetchByUrlSchema,
  wikifxTopicsQuerySchema,
} from './wikifx.schema';
import { WikifxService } from './wikifx.service';

@Controller('topics/wikifx')
@UseGuards(AdminKeyGuard)
export class WikifxController {
  private assertConfiguredAdminKey() {
    if (!process.env.ADMIN_API_KEY) {
      throw new ServiceUnavailableException(
        'WikiFX topics require ADMIN_API_KEY configuration',
      );
    }
  }
  constructor(private readonly wikifx: WikifxService) {}

  @Get()
  async topics(
    @CurrentUser() user: RequestUser,
    @Query() query: Record<string, unknown>,
  ) {
    this.assertConfiguredAdminKey();
    const parsed = wikifxTopicsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.wikifx.topics(user, parsed.data.days, parsed.data.top);
  }

  @Post('adopt')
  async adopt(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    this.assertConfiguredAdminKey();
    const parsed = wikifxAdoptSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.wikifx.adopt(user, parsed.data);
  }

  /**
   * 手动抓取：粘贴 WikiFX newsdetail 链接，服务端解析后读正文并短期缓存。
   * 浏览器提交的正文/标题不会入库，采用时服务端从缓存取可信内容。
   */
  @Post('fetch-by-url')
  async fetchByUrl(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    this.assertConfiguredAdminKey();
    const parsed = wikifxFetchByUrlSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.wikifx.fetchByUrl(user, parsed.data.url, parsed.data.force);
  }
}
