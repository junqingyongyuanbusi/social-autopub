import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { GenerationJobData, QUEUE_GENERATION } from "../queues";

@Injectable()
export class GenerationRecoveryService {
  private readonly logger = new Logger(GenerationRecoveryService.name);
  private static readonly STALE_MS = 10 * 60 * 1000;
  private static readonly RETRY = {
    attempts: 2,
    backoff: { type: "exponential" as const, delay: 30_000 },
  };
  private static readonly LIVE_JOB_STATES = new Set([
    "active",
    "waiting",
    "delayed",
    "prioritized",
    "waiting-children",
  ]);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_GENERATION)
    private readonly generationQueue: Queue<GenerationJobData>,
  ) {}

  @Cron("*/5 * * * *")
  async reconcile() {
    const staleSince = new Date(Date.now() - GenerationRecoveryService.STALE_MS);
    try {
      const staleItems = await this.prisma.contentItem.findMany({
        where: {
          status: "GENERATING",
          updatedAt: { lt: staleSince },
          jobs: { none: {} },
        },
        select: { id: true, generationRevision: true },
      });
      let recovered = 0;
      for (const item of staleItems) {
        if ((await this.inspectJobs(item.id, item.generationRevision)).live) continue;
        if (await this.recover(item.id, item.generationRevision, staleSince)) {
          recovered++;
        }
      }
      const pendingItems = await this.prisma.contentItem.findMany({
        where: {
          status: "PENDING",
          updatedAt: { lt: staleSince },
          jobs: { none: {} },
        },
        select: { id: true, generationRevision: true, forceReview: true },
      });
      let resumed = 0;
      for (const item of pendingItems) {
        const jobs = await this.inspectJobs(item.id, item.generationRevision);
        if (jobs.live) continue;
        const didResume = jobs.currentTerminal
          ? await this.resumePendingWithNewRevision(
              item.id,
              item.generationRevision,
              staleSince,
              item.forceReview,
            )
          : await this.enqueuePendingRevision(
              item.id,
              item.generationRevision,
              item.forceReview,
            );
        if (didResume) resumed++;
      }
      if (resumed) {
        this.logger.warn(`补投 ${resumed} 个遗漏的 generation recovery 任务`);
      }
      if (recovered) {
        this.logger.warn(`恢复 ${recovered} 个孤儿 generation 任务并强制进入审核`);
      }
      return recovered + resumed;
    } catch (error) {
      this.logger.error(`generation 补偿扫描失败: ${(error as Error).message}`);
      return 0;
    }
  }

  private async inspectJobs(contentItemId: string, revision: number) {
    const currentJobId = `generation-${contentItemId}-r${revision}`;
    const jobIds = Array.from(
      { length: revision + 1 },
      (_, candidateRevision) =>
        `generation-${contentItemId}-r${candidateRevision}`,
    );
    jobIds.push(`generation-${contentItemId}`);
    let currentTerminal = false;
    for (const jobId of jobIds) {
      const job = await this.generationQueue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (GenerationRecoveryService.LIVE_JOB_STATES.has(state)) {
        return { live: true, currentTerminal: false };
      }
      if (state === "completed" || state === "failed") {
        if (jobId === currentJobId) currentTerminal = true;
        continue;
      }
      this.logger.warn(`跳过状态未知的 generation job ${jobId}: ${state}`);
      return { live: true, currentTerminal: false };
    }
    return { live: false, currentTerminal };
  }

  private async enqueuePendingRevision(
    contentItemId: string,
    generationRevision: number,
    forceReview: boolean,
  ) {
    try {
      await this.generationQueue.add(
        "generate",
        { contentItemId, forceReview, generationRevision },
        {
          jobId: `generation-${contentItemId}-r${generationRevision}`,
          ...GenerationRecoveryService.RETRY,
        },
      );
      await this.prisma.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: "PENDING",
          generationRevision,
          jobs: { none: {} },
        },
        data: { updatedAt: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `generation recovery 补投失败 ${contentItemId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async resumePendingWithNewRevision(
    contentItemId: string,
    generationRevision: number,
    staleSince: Date,
    forceReview: boolean,
  ) {
    const revision = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: "PENDING",
          generationRevision,
          updatedAt: { lt: staleSince },
          jobs: { none: {} },
        },
        data: { generationRevision: { increment: 1 }, updatedAt: new Date() },
      });
      if (!claimed.count) return null;
      await tx.generation.deleteMany({ where: { contentItemId } });
      return (
        await tx.contentItem.findUniqueOrThrow({
          where: { id: contentItemId },
          select: { generationRevision: true },
        })
      ).generationRevision;
    });
    if (revision === null) return false;
    return this.enqueuePendingRevision(contentItemId, revision, forceReview);
  }
  private async recover(
    contentItemId: string,
    generationRevision: number,
    staleSince: Date,
  ) {
    const revision = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: "GENERATING",
          generationRevision,
          updatedAt: { lt: staleSince },
          jobs: { none: {} },
        },
        data: {
          status: "PENDING",
          lastError: null,
          forceReview: true,
          generationRevision: { increment: 1 },
        },
      });
      if (!claimed.count) return null;
      await tx.generation.deleteMany({ where: { contentItemId } });
      return (
        await tx.contentItem.findUniqueOrThrow({
          where: { id: contentItemId },
          select: { generationRevision: true },
        })
      ).generationRevision;
    });
    if (revision === null) return false;

    try {
      await this.generationQueue.add(
        "generate",
        { contentItemId, forceReview: true, generationRevision: revision },
        {
          jobId: `generation-${contentItemId}-r${revision}`,
          ...GenerationRecoveryService.RETRY,
        },
      );
      return true;
    } catch (error) {
      await this.prisma.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: "PENDING",
          generationRevision: revision,
        },
        data: {
          status: "FAILED",
          lastError: `generation recovery enqueue failed: ${(error as Error).message}`,
        },
      });
      throw error;
    }
  }
}
