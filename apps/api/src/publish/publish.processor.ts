import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import {
  PostizClient,
  PostizOutcomeUnknownError,
  PreparedPostizMedia,
} from "../postiz/postiz.client";
import { QUEUE_PUBLISH, PublishJobData } from "../queues";
import {
  composeSocialPost,
  ContentValidationError,
} from "../generation/social-post"
import { validateForPlatform } from "../generation/validators"
import { concludePublishRevision } from "./finalize-revision";

// 发布 worker：限流 25/小时对齐现有 Postiz 发布配额策略。
@Processor(QUEUE_PUBLISH, {
  concurrency: 1,
  limiter: { max: 25, duration: 3_600_000 },
})
export class PublishProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly postiz: PostizClient,
  ) {
    super();
  }

  async process(job: Job<PublishJobData>) {
    const candidate = await this.prisma.publishJob.findUnique({
      where: { id: job.data.publishJobId },
      select: { status: true },
    });
    if (!candidate || !['queued', 'failed'].includes(candidate.status)) return;
    await this.postiz.acquireRequestBudget();
    // 原子领取：只在待处理状态（queued/failed）时抢占为 publishing，
    // 防止「补偿重入队 / 手动重试 / 失败重投」叠加时同一子任务并发执行 createPost 而重复发布
    const claimed = await this.prisma.publishJob.updateMany({
      where: { id: job.data.publishJobId, status: { in: ["queued", "failed"] } },
      data: { status: "publishing", error: null },
    });
    if (!claimed.count) return; // 已被其他执行流领取或已到终态（含已 sent 的幂等保护）

    const pj = await this.prisma.publishJob.findUniqueOrThrow({
      where: { id: job.data.publishJobId },
      include: { contentItem: { include: { generations: true } } },
    });

    if (
      pj.contentItem.status !== "PUBLISHING" ||
      pj.publishRevision !== pj.contentItem.publishRevision
    ) {
      await this.prisma.publishJob.updateMany({
        where: { id: pj.id, status: "publishing" },
        data: { status: "cancelled", error: "stale publish revision" },
      });
      return
    }
    const gen = pj.contentItem.generations.find(
      (g) => g.platform === pj.platform,
    );

    let remoteAccepted = false;
    try {
      if (!gen) throw new Error(`generation missing for ${pj.platform}`);
      const generationMedia = this.stringArray(gen.media);
      if (pj.mediaSnapshot == null && generationMedia.length) {
        throw new ContentValidationError(
          "旧发布任务缺少媒体快照，请返回审核后重新批准",
        );
      }
      const preparedMedia = this.preparedMedia(pj.mediaSnapshot);
      if (
        !Array.isArray(pj.mediaSnapshot) ||
        preparedMedia.length !== pj.mediaSnapshot.length ||
        preparedMedia.length !== generationMedia.length
      ) {
        throw new ContentValidationError(
          "发布媒体快照不完整，请返回审核后重新批准",
        );
      }
      // IG 必须带图：无图直接失败并给出明确修复路径，不消耗 Postiz 配额
      if (pj.platform === "instagram" && !preparedMedia.length) {
        throw new ContentValidationError(
          "Instagram 发布必须包含图片，请在审核工作台补充媒体后重试",
        );
      }

      const finalContent = composeSocialPost(
        pj.platform,
        gen.content,
        pj.contentItem,
      ).content;
      const validationProblems = validateForPlatform(
        pj.platform,
        finalContent,
        gen.content,
      )
      if (validationProblems.length) {
        throw new ContentValidationError(validationProblems.join("；"))
      }

      const { postId } = await this.postiz.createPost({
        integrationId: pj.postizIntegrationId,
        platform: pj.platform,
        content: finalContent,
        preparedMedia,
        publishAt: pj.scheduledAt,
        settings: gen.settings as object | null,
        dryRun: process.env.DRY_RUN === "true",
        requestBudgetAcquired: true,
      });
      remoteAccepted = true;
      const persisted = await this.prisma.publishJob.updateMany({
        where: {
          id: pj.id,
          status: "publishing",
          publishRevision: pj.publishRevision,
        },
        data: { status: "sent", postizPostId: postId ?? null, error: null },
      });
      if (!persisted.count) {
        throw new Error("publish claim changed before sent status persisted");
      }
      await concludePublishRevision(
        this.prisma,
        pj.contentItemId,
        pj.publishRevision,
      );
    } catch (e) {
      if (remoteAccepted) {
        const message = `Postiz 已受理，但本地状态收敛失败：${(e as Error).message}`;
        try {
          await this.prisma.publishJob.updateMany({
            where: { id: pj.id, status: "publishing" },
            data: { status: "unknown", error: message },
          });
          await this.prisma.contentItem.updateMany({
            where: {
              id: pj.contentItemId,
              status: "PUBLISHING",
              publishRevision: pj.publishRevision,
            },
            data: { lastError: message },
          });
        } catch (compensationError) {
          this.logger.error(
            `remote publish accepted; local compensation failed for ${pj.id}: ${(compensationError as Error).message}`,
          );
        }
        return;
      }
      if (e instanceof PostizOutcomeUnknownError) {
        try {
          await this.prisma.publishJob.updateMany({
            where: { id: pj.id, status: "publishing" },
            data: { status: "unknown", error: e.message },
          });
          await this.prisma.contentItem.updateMany({
            where: {
              id: pj.contentItemId,
              status: "PUBLISHING",
              publishRevision: pj.publishRevision,
            },
            data: { lastError: e.message },
          });
        } catch (compensationError) {
          this.logger.error(
            `unknown Postiz outcome compensation failed for ${pj.id}: ${(compensationError as Error).message}`,
          );
        }
        return;
      }
      if (e instanceof ContentValidationError) {
        await this.prisma.publishJob.update({
          where: { id: pj.id },
          data: { status: "failed", error: e.message },
        });
        await concludePublishRevision(
          this.prisma,
          pj.contentItemId,
          pj.publishRevision,
        );
        return;
      }
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.contentItem.updateMany({
        where: {
          id: pj.contentItemId,
          status: "PUBLISHING",
          publishRevision: pj.publishRevision,
        },
        data: { lastError: (e as Error).message },
      });
      await this.prisma.publishJob.update({
        where: { id: pj.id },
        data: {
          status: isFinalAttempt ? "failed" : "queued",
          error: (e as Error).message,
        },
      });
      if (isFinalAttempt) {
        await concludePublishRevision(
          this.prisma,
          pj.contentItemId,
          pj.publishRevision,
        );
      }
      throw e; // 非最终次由 BullMQ 按退避重试
    }
  }

  private preparedMedia(value: unknown): PreparedPostizMedia[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const media = entry as Record<string, unknown>;
      return typeof media.id === "string" && typeof media.path === "string"
        ? [{ id: media.id, path: media.path }]
        : [];
    });
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

}
