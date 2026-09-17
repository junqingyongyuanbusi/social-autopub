import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CurrentUser, RequestUser } from '../common/current-user';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSyncService } from './analytics-sync.service';

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
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly syncService: AnalyticsSyncService,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: RequestUser, @Query('days') days?: string) {
    return this.analytics.overview(user, parseDays(days));
  }

  // 手动 / 页面切入时触发一次同步（带 3 分钟防抖冷却；可通过 ?force=true 强制）
  @Post('sync')
  async syncNow(@Query('force') force?: string) {
    return this.syncService.syncNow(force === 'true');
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
