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
}
