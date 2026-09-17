import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PostizClient } from '../postiz/postiz.client';

// 发布链路只记录「Postiz 是否受理」：受理即 sent/PUBLISHED，不跟踪 Postiz 后续投递结果。
// Postiz 受理后投递社媒失败（state=ERROR）时，本地仍显示已发布，出现「系统显示已发布、社媒上没有」。
// 本服务每 30 分钟（错峰 :20/:50）回读近 48 小时受理帖子的真实状态，把投递失败回退为
// failed + 内容 FAILED，使其可在发布记录页人工重试；投递成功不做任何变更。
@Injectable()
export class PostizDeliveryReconcileService {
  private readonly logger = new Logger(PostizDeliveryReconcileService.name);
  private static readonly LOOKBACK_MS = 48 * 60 * 60 * 1000;
  private static readonly MAX_JOBS = 200;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly postiz: PostizClient,
  ) {}

  @Cron('20,50 * * * *')
  async reconcile(): Promise<void> {
    if (!process.env.POSTIZ_API_URL) return;
    if (this.running) return; // 上一轮仍在等待限流预算时跳过本轮
    this.running = true;
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.warn(`发布投递对账失败：${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const since = new Date(
      Date.now() - PostizDeliveryReconcileService.LOOKBACK_MS,
    );
    const sentJobs = await this.prisma.publishJob.findMany({
      where: {
        status: 'sent',
        postizPostId: { not: null },
        updatedAt: { gte: since },
      },
      select: { id: true, postizPostId: true, contentItemId: true },
      orderBy: { updatedAt: 'desc' },
      take: PostizDeliveryReconcileService.MAX_JOBS,
    });
    // 没有近期受理的帖子时不消耗 Postiz 配额
    if (!sentJobs.length) return;

    const posts = await this.postiz.listPosts(
      new Date(since.getTime() - 3_600_000),
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    const stateByPostId = new Map(
      posts.map((post) => [post.id, post.state ?? '']),
    );

    let failedJobs = 0;
    for (const job of sentJobs) {
      if (stateByPostId.get(job.postizPostId as string) !== 'ERROR') continue;
      const updated = await this.prisma.publishJob.updateMany({
        where: { id: job.id, status: 'sent' },
        data: {
          status: 'failed',
          error: 'Postiz 投递失败（state=ERROR），可在发布记录页重试',
        },
      });
      if (!updated.count) continue;
      failedJobs += 1;
      // 内容已收敛为 PUBLISHED 时同步回退为 FAILED：人工重试入口要求内容为 FAILED
      await this.prisma.contentItem.updateMany({
        where: { id: job.contentItemId, status: 'PUBLISHED' },
        data: {
          status: 'FAILED',
          lastError: '存在投递失败的平台，可在发布记录页重试',
        },
      });
    }
    if (failedJobs) {
      this.logger.warn(
        `发布投递对账：${failedJobs} 个帖子在 Postiz 侧投递失败，已回退为可重试状态`,
      );
    }
  }
}
