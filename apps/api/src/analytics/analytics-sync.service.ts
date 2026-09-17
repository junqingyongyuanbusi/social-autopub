import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PostizAnalyticsSeries, PostizClient } from '../postiz/postiz.client';

// Postiz analytics 端点最多回看 90 天（X 免费层仅 28 天），采集窗口取 30 天
const FETCH_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

// 每 30 分钟从 Postiz analytics 采集账号级与帖子级指标快照。
// 与账号同步（:00/:30）错峰在 :10/:40 执行；Postiz 默认限流 30 req/h 且与发布共享，
// 单轮请求量由 POSTIZ_ANALYTICS_BATCH 封顶（默认 10），超出部分留待下一轮，避免挤占发布预算。
@Injectable()
export class AnalyticsSyncService {
  private readonly logger = new Logger(AnalyticsSyncService.name);
  private running = false;
  private lastSyncCompletedAt: Date | null = null;
  // 冷却时间：默认 3 分钟防抖，防止用户频繁切换页面把 Postiz 限流配额打爆
  private static readonly COOLDOWN_MS = 3 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly postiz: PostizClient,
  ) {}

  @Cron('10,40 * * * *')
  async sync(): Promise<void> {
    await this.syncNow(false);
  }

  // 手动/页面切入时触发的同步：带冷却防抖保护
  async syncNow(force = false): Promise<{
    synced: boolean;
    reason?: string;
    lastSyncedAt: string | null;
  }> {
    if (!process.env.POSTIZ_API_URL) {
      return { synced: false, reason: 'not_configured', lastSyncedAt: null };
    }
    if (this.running) {
      return {
        synced: false,
        reason: 'already_running',
        lastSyncedAt: this.lastSyncCompletedAt?.toISOString() ?? null,
      };
    }
    if (
      !force &&
      this.lastSyncCompletedAt &&
      Date.now() - this.lastSyncCompletedAt.getTime() < AnalyticsSyncService.COOLDOWN_MS
    ) {
      return {
        synced: false,
        reason: 'cooldown',
        lastSyncedAt: this.lastSyncCompletedAt.toISOString(),
      };
    }
    this.running = true;
    try {
      const remaining = await this.syncAccountMetrics(this.maxRequestsPerRound());
      await this.syncPostMetrics(remaining);
      this.lastSyncCompletedAt = new Date();
      return {
        synced: true,
        lastSyncedAt: this.lastSyncCompletedAt.toISOString(),
      };
    } catch (error) {
      this.logger.warn(`analytics 采集轮次异常：${(error as Error).message}`);
      return {
        synced: false,
        reason: (error as Error).message,
        lastSyncedAt: this.lastSyncCompletedAt?.toISOString() ?? null,
      };
    } finally {
      this.running = false;
    }
  }

  getLastSyncCompletedAt(): Date | null {
    return this.lastSyncCompletedAt;
  }

  // 账号级指标：每个 active 账号一次集成级 analytics 请求；返回剩余预算
  private async syncAccountMetrics(budget: number): Promise<number> {
    const accounts = await this.prisma.account.findMany({
      where: { status: 'active' },
      select: { id: true, postizIntegrationId: true },
      orderBy: { id: 'asc' },
    });
    let remaining = budget;
    for (const account of accounts) {
      if (remaining <= 0) {
        this.logger.log(`本轮限流预算用尽，账号级采集提前结束（剩余 ${accounts.length} 个账号待下轮）`);
        return remaining;
      }
      remaining -= 1;
      try {
        const seriesList = await this.postiz.getIntegrationAnalytics(
          account.postizIntegrationId,
          FETCH_WINDOW_DAYS,
        );
        await this.persistAccountSeries(account.id, seriesList);
      } catch (error) {
        this.logger.warn(`账号 ${account.id} analytics 采集失败：${(error as Error).message}`);
      }
    }
    return remaining;
  }

  // 帖子级指标：仅采集窗口内已成功发布且有 postizPostId 的任务，最久未刷新的优先
  private async syncPostMetrics(budget: number): Promise<void> {
    if (budget <= 0) {
      this.logger.log('本轮限流预算用尽，帖子级采集跳过');
      return;
    }
    const since = new Date(Date.now() - FETCH_WINDOW_DAYS * DAY_MS);
    const jobs = await this.prisma.publishJob.findMany({
      where: {
        status: 'sent',
        postizPostId: { not: null },
        updatedAt: { gte: since },
      },
      select: { id: true, postizPostId: true },
      orderBy: { updatedAt: 'asc' },
      take: budget,
    });
    for (const job of jobs) {
      try {
        const seriesList = await this.postiz.getPostAnalytics(
          job.postizPostId as string,
          FETCH_WINDOW_DAYS,
        );
        await this.persistPostSeries(job.id, seriesList);
      } catch (error) {
        this.logger.warn(`帖子 ${job.id} analytics 采集失败：${(error as Error).message}`);
      }
    }
  }

  private async persistAccountSeries(
    accountId: string,
    seriesList: PostizAnalyticsSeries[],
  ): Promise<void> {
    for (const series of seriesList) {
      for (const point of series.data ?? []) {
        const date = this.parseSnapshotDate(point.date);
        const value = Number(point.total);
        if (!date || !Number.isFinite(value)) continue;
        await this.prisma.accountMetricSnapshot.upsert({
          where: {
            accountId_metric_date: { accountId, metric: series.label, date },
          },
          create: { accountId, metric: series.label, date, value },
          update: { value },
        });
      }
    }
  }

  private async persistPostSeries(
    publishJobId: string,
    seriesList: PostizAnalyticsSeries[],
  ): Promise<void> {
    for (const series of seriesList) {
      for (const point of series.data ?? []) {
        const date = this.parseSnapshotDate(point.date);
        const value = Number(point.total);
        if (!date || !Number.isFinite(value)) continue;
        await this.prisma.postMetricSnapshot.upsert({
          where: {
            publishJobId_metric_date: { publishJobId, metric: series.label, date },
          },
          create: { publishJobId, metric: series.label, date, value },
          update: { value },
        });
      }
    }
  }

  // Postiz 日期形如 '2026-09-15'；按 UTC 零点解析与 @db.Date 存储口径一致
  private parseSnapshotDate(raw: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private maxRequestsPerRound(): number {
    return Math.max(1, Number(process.env.POSTIZ_ANALYTICS_BATCH ?? 10) || 10);
  }
}
