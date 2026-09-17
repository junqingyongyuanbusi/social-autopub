import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CurrentUser, RequestUser } from '../common/current-user';
import { AnalyticsService } from './analytics.service';

// 时间窗口仅开放 7/30/90 天，与 Postiz analytics 端点的文档口径一致
const daysSchema = z.coerce
  .number()
  .int()
  .refine((value) => [7, 30, 90].includes(value), 'days 仅支持 7 / 30 / 90')
  .default(30);

// 分析查询：可见性沿用账号授权模型（admin 全量 / operator 仅被分配账号）
@Controller('analytics')
@UseGuards(AdminKeyGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  async overview(@CurrentUser() user: RequestUser, @Query('days') days?: string) {
    return this.analytics.overview(user, parseDays(days));
  }

  @Get('accounts/:accountId')
  async account(
    @CurrentUser() user: RequestUser,
    @Param('accountId') accountId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.accountSeries(user, accountId, parseDays(days));
  }

  @Get('posts')
  async posts(@CurrentUser() user: RequestUser, @Query('days') days?: string) {
    return this.analytics.posts(user, parseDays(days));
  }
}

function parseDays(raw: string | undefined): number {
  const parsed = daysSchema.safeParse(raw ?? undefined);
  return parsed.success ? parsed.data : 30;
}
