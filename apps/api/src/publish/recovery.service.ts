import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_PUBLISH,
  QUEUE_PUBLISH_PREPARE,
  PublishJobData,
  PublishPrepareJobData,
} from '../queues';
import { PublishService } from './publish.service';
import { concludePublishRevision } from './finalize-revision';

// 队列补偿：Redis 掉电/扩容重启会丢失排队中的 job，但 DB 行仍停在「queued」，
// 失控时对应的帖子就永远发不出去。周期扫描「超时未推进」的发布子任务重新入队；
// 所有条件更新都带 status/updatedAt 守卫 + processor 侧原子领取，避免并发覆盖与重复发送。
// 注意：补偿只回收「从未发出」的任务（stale queued），不自动重发 publishing（at-least-once
// 下可能真发过但响应丢失），后者留给人审发布记录。
@Injectable()
export class PublishRecoveryService {
  private readonly logger = new Logger(PublishRecoveryService.name);
  private static readonly STALE_MS = 15 * 60 * 1000;
  private static readonly RETRY = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 60_000 },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PublishService,
    @InjectQueue(QUEUE_PUBLISH_PREPARE)
    private readonly prepareQueue: Queue<PublishPrepareJobData>,
    @InjectQueue(QUEUE_PUBLISH)
    private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  @Cron('*/10 * * * *')
  async reconcile() {
    const staleSince = new Date(Date.now() - PublishRecoveryService.STALE_MS);
    try {
      const staleApproved = await this.prisma.contentItem.findMany({
        where: {
          status: 'APPROVED',
          publishTargets: { not: Prisma.JsonNull },
          updatedAt: { lt: staleSince },
        },
        select: { id: true },
      });
      for (const item of staleApproved) {
        try {
          await this.publish.dispatchStoredTargets(item.id);
        } catch (error) {
          this.logger.error(
            `approved publish intent recovery failed ${item.id}: ${(error as Error).message}`,
          );
        }
      }

      const stalePublishingItems = await this.prisma.contentItem.findMany({
        where: {
          status: 'PUBLISHING',
          updatedAt: { lt: staleSince },
        },
        select: {
          id: true,
          publishRevision: true,
          jobs: { select: { publishRevision: true } },
        },
      });
      const stalePrepare = stalePublishingItems.filter(
        (item) =>
          !item.jobs.some(
            (job) => job.publishRevision === item.publishRevision,
          ),
      );
      let requeuedPrepare = 0;
      for (const { id, publishRevision } of stalePrepare) {
        const jobId = `prepare-${id}-r${publishRevision}`;
        const existing = await this.prepareQueue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'failed' || state === 'completed') {
            await existing.remove();
          } else {
            continue;
          }
        }
        await this.prepareQueue.add(
          'prepare-publish',
          { contentItemId: id, publishRevision },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        );
        const updated = await this.prisma.contentItem.updateMany({
          where: { id, status: 'PUBLISHING', publishRevision },
          data: { updatedAt: new Date() },
        });
        requeuedPrepare += updated.count;
      }
      if (requeuedPrepare) {
        this.logger.warn(`补偿重入队 ${requeuedPrepare} 个发布准备任务`);
      }

      // 1) Redis 重启后彻底丢失的「queued」：从未被领取，必然未发送，安全重入队
      const staleQueuedCandidates = await this.prisma.publishJob.findMany({
        where: {
          status: 'queued',
          updatedAt: { lt: staleSince },
          contentItem: { status: 'PUBLISHING' },
        },
        select: {
          id: true,
          publishRevision: true,
          contentItem: { select: { publishRevision: true } },
        },
      });
      const staleQueued = staleQueuedCandidates.filter(
        (job) => job.publishRevision === job.contentItem.publishRevision,
      );
      let requeuedPublish = 0;
      for (const { id, publishRevision } of staleQueued) {
        const jobId = `publish-${id}-r${publishRevision}`;
        const existing = await this.publishQueue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (
            ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(
              state,
            )
          ) {
            continue;
          }
          await existing.remove();
        }
        await this.publishQueue.add(
          'publish',
          { publishJobId: id },
          { ...PublishRecoveryService.RETRY, jobId },
        );
        const updated = await this.prisma.publishJob.updateMany({
          where: { id, status: 'queued', publishRevision },
          data: { updatedAt: new Date() },
        });
        requeuedPublish += updated.count;
      }
      if (requeuedPublish) {
        this.logger.warn(`补偿重入队 ${requeuedPublish} 个孤儿 queued 发布任务`);
      }

      const pendingFinalization = await this.prisma.contentItem.findMany({
        where: { status: 'PUBLISHING' },
        select: { id: true, publishRevision: true },
      });
      let finalized = 0;
      for (const item of pendingFinalization) {
        const result = await concludePublishRevision(
          this.prisma,
          item.id,
          item.publishRevision,
        );
        if (result.applied) finalized++;
      }
      if (finalized) {
        this.logger.warn(`补偿收敛 ${finalized} 个仅缺本地 finalize 的发布批次`);
      }

      // 2) claim 后崩溃的 stale publishing：结果未知，绝不自动重发，转入人工对账。
      const stalePublishingCandidates = await this.prisma.publishJob.findMany({
        where: {
          status: 'publishing',
          updatedAt: { lt: staleSince },
          contentItem: { status: 'PUBLISHING' },
        },
        select: {
          id: true,
          publishRevision: true,
          contentItem: { select: { publishRevision: true } },
        },
      });
      let movedToUnknown = 0;
      for (const job of stalePublishingCandidates) {
        if (job.publishRevision !== job.contentItem.publishRevision) continue;
        const updated = await this.prisma.publishJob.updateMany({
          where: {
            id: job.id,
            status: 'publishing',
            updatedAt: { lt: staleSince },
          },
          data: {
            status: 'unknown',
            error: '发布 worker 中断，远端结果未知，请人工对账',
          },
        });
        movedToUnknown += updated.count;
      }
      if (movedToUnknown) {
        this.logger.error(
          `${movedToUnknown} 个 stale publishing 发布任务已转为 unknown，请在发布记录页人工对账`,
        );
      }
    } catch (e) {
      this.logger.error(`发布任务补偿扫描失败: ${(e as Error).message}`);
    }
  }
}
