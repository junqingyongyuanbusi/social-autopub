import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { PostizClient } from "../postiz/postiz.client";
import { QUEUE_PUBLISH, PublishJobData } from "../queues";

// 发布 worker：限流 25/小时对齐 Postiz 默认 API_LIMIT=30 留余量
@Processor(QUEUE_PUBLISH, {
  concurrency: 1,
  limiter: { max: 25, duration: 3_600_000 },
})
export class PublishProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postiz: PostizClient,
  ) {
    super();
  }

  async process(job: Job<PublishJobData>) {
    const pj = await this.prisma.publishJob.findUniqueOrThrow({
      where: { id: job.data.publishJobId },
      include: { contentItem: { include: { generations: true } } },
    });
    if (pj.status === "sent") return; // 手动重试等场景的幂等保护

    const gen = pj.contentItem.generations.find(
      (g) => g.platform === pj.platform,
    );
    const mediaUrls = ((gen?.media ?? []) as string[]).filter(Boolean);

    try {
      if (!gen) throw new Error(`generation missing for ${pj.platform}`);
      // IG 必须带图：无图直接失败并给出明确修复路径，不消耗 Postiz 配额
      if (pj.platform === "instagram" && !mediaUrls.length) {
        throw new Error(
          "Instagram 发布必须包含图片，请在审核工作台补充媒体后重试",
        );
      }

      const { postId } = await this.postiz.createPost({
        integrationId: pj.postizIntegrationId,
        platform: pj.platform,
        content: gen.content,
        mediaUrls,
        publishAt: pj.scheduledAt,
        settings: gen.settings as object | null,
        dryRun: process.env.DRY_RUN === "true",
      });
      await this.prisma.publishJob.update({
        where: { id: pj.id },
        data: { status: "sent", postizPostId: postId ?? null, error: null },
      });
      await this.finalize(pj.contentItemId);
    } catch (e) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.publishJob.update({
        where: { id: pj.id },
        data: {
          status: isFinalAttempt ? "failed" : "queued",
          error: (e as Error).message,
        },
      });
      if (isFinalAttempt) await this.finalize(pj.contentItemId);
      throw e; // 非最终次由 BullMQ 按退避重试
    }
  }

  // 所有子任务出结果后只收敛本地内容状态；Notion 仅作为触发输入，不做回写
  private async finalize(contentItemId: string) {
    const jobs = await this.prisma.publishJob.findMany({
      where: { contentItemId },
    });
    if (!jobs.length || jobs.some((j) => j.status === "queued")) return;

    const allSent = jobs.every((j) => j.status === "sent");
    await this.prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: allSent ? "PUBLISHED" : "FAILED" },
    });
  }
}
