import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_PUBLISH, PublishJobData } from '../queues';

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
    @InjectQueue(QUEUE_PUBLISH)
    private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  @Cron('*/10 * * * *')
  async reconcile() {
    const staleSince = new Date(Date.now() - PublishRecoveryService.STALE_MS);
    try {
      // 1) Redis 重启后彻底丢失的「queued」：从未被领取，必然未发送，安全重入队
      const staleQueued = await this.prisma.publishJob.findMany({
        where: {
          status: 'queued',
          updatedAt: { lt: staleSince },
          contentItem: { status: 'PUBLISHING' },
        },
        select: { id: true },
      });
      for (const { id } of staleQueued) {
        await this.publishQueue.add('publish', { publishJobId: id }, PublishRecoveryService.RETRY);
        // 条件刷新 updatedAt，避免每轮重复入队；若期间已被 worker 领取，则跳过
        await this.prisma.publishJob.updateMany({
          where: { id, status: 'queued' },
          data: { updatedAt: new Date() },
        });
      }
      if (staleQueued.length)
        this.logger.warn(`补偿重入队 ${staleQueued.length} 个孤儿 queued 发布任务`);

      // 2) 进程崩溃残留在「publishing」的任务：发起方已死、永无闭环。留在终态由人看，
      //    只把「从未发出过」也归拢提醒：不做自动重发（避免重复发布到真实账号）
      const stalePublishing = await this.prisma.publishJob.count({
        where: {
          status: 'publishing',
          updatedAt: { lt: staleSince },
          contentItem: { status: 'PUBLISHING' },
        },
      });
      if (stalePublishing)
        this.logger.error(
          `${stalePublishing} 个发布任务滞留 publishing 超 ${PublishRecoveryService.STALE_MS / 60000} 分钟，请在发布记录页人工核实是否已发送后处理`,
        );
    } catch (e) {
      this.logger.error(`发布任务补偿扫描失败: ${(e as Error).message}`);
    }
  }
}
