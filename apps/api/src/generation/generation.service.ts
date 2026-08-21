import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { PublishService } from "../publish/publish.service";
import { RoutingService } from "../publish/routing.service";
import { LlmClient } from "./llm.client";
import { outputLanguageFor } from "./output-language";
import { PromptConfigService } from "./prompt-config.service";
import {
  buildGenerationPrompt,
  buildRevisePrompt,
  PromptConfig,
} from "./prompts";
import { validateForPlatform } from "./validators";
import {
  bodyBudget,
  composeSocialPost,
  ContentValidationError,
  exposureReviewLinkProblem,
} from "./social-post"

const outputSchema = z.object({ content: z.string().min(1) });

// 有界生成循环：生成 → 确定性校验 → 带错误反馈重写（最多 2 轮）。
// 骨架保持确定性 pipeline，LLM 只负责生成环节，成本与行为可控
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private static readonly MAX_REVISIONS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly publish: PublishService,
    private readonly llm: LlmClient,
    private readonly prompts: PromptConfigService,
  ) {}

  async generateFor(
    contentItemId: string,
    forceReview = false,
    generationRevision?: number,
  ) {
    const expectedRevision = generationRevision ?? 0
    const claimed = await this.prisma.contentItem.updateMany({
      where: {
        id: contentItemId,
        status: "PENDING",
        generationRevision: expectedRevision,
      },
      data: { status: "GENERATING", lastError: null }
    });
    if (!claimed.count) return;

    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
    });

    const mustReview = forceReview || item.forceReview
    const linkProblem = exposureReviewLinkProblem(item);
    if (linkProblem) {
      await this.prisma.contentItem.updateMany({
        where: {
          id: item.id,
          status: "GENERATING",
          generationRevision: expectedRevision,
        },
        data: { status: "FAILED", lastError: linkProblem },
      });
      return;
    }
    // 目标平台：内容指定优先，否则取路由矩阵中该语言×类型已配置的平台
    if (!(await this.isGenerating(item.id, expectedRevision))) return;
    const platforms = item.targetPlatforms.length
      ? item.targetPlatforms
      : await this.routing.platformsFor(item.language, item.contentType);
    if (!platforms.length) {
      const failed = await this.prisma.contentItem.updateMany({
        where: {
          id: item.id,
          status: "GENERATING",
          generationRevision: expectedRevision,
        },
        data: {
          status: "FAILED",
          lastError: `未配置发布路由：${item.language}/${item.contentType}`,
        }
      });
      if (!failed.count) return;
      throw new Error(
        `no routing platforms for ${item.language}/${item.contentType}`,
      );
    }

    const promptConfig = await this.prompts.getActive();
    const finalProblems: string[] = []
    for (const platform of platforms) {
      if (!(await this.isGenerating(item.id, expectedRevision))) return;
      const result = await this.generateOne(platform, item, promptConfig);
      finalProblems.push(...result.problems.map((problem) => `${platform}: ${problem}`));
      if (
        !(await this.saveGenerationIfOwned(
          item.id,
          expectedRevision,
          platform,
          result.content,
          promptConfig.id,
          (item.media ?? []) as Prisma.InputJsonValue,
        ))
      )
        return
    }

    // AUTO_PUBLISH=true：生成完成即发布（Notion 勾选 social_media_sent 即视为人工确认）
    // 否则进入控制台人工审核；WikiFX 始终强制人工审核
    const shouldAutoPublish =
      !mustReview &&
      finalProblems.length === 0 &&
      process.env.AUTO_PUBLISH === "true" &&
      item.source !== "wikifx"
    const publishTargets = shouldAutoPublish
      ? await this.publish.targetSnapshot(item.id)
      : [];
    const autoPublishReady =
      shouldAutoPublish && publishTargets.length === platforms.length;
    const transitioned = await this.prisma.contentItem.updateMany({
      where: {
        id: item.id,
        status: "GENERATING",
        generationRevision: expectedRevision,
      },
      data: {
        status: autoPublishReady ? "APPROVED" : "REVIEW",
        lastError: finalProblems.length
          ? finalProblems.join("；")
          : shouldAutoPublish && !autoPublishReady
            ? "未配置完整发布账号，已转人工审核"
            : null,
        forceReview: autoPublishReady
          ? false
          : mustReview || (shouldAutoPublish && !autoPublishReady),
        publishTargets: autoPublishReady ? publishTargets : Prisma.JsonNull,
      }
    });
    if (!transitioned.count) return;

    if (autoPublishReady) {
      try {
        const preparationQueued = await this.publish.dispatch(
          item.id,
          publishTargets,
        );
        this.logger.log(
          `publish preparation queued for ${item.id}: ${preparationQueued} batch job(s) for ${platforms.length} platform(s)`,
        );
      } catch (error) {
        await this.prisma.contentItem.updateMany({
          where: {
            id: item.id,
            status: { in: ["APPROVED", "PUBLISHING"] },
            generationRevision: expectedRevision,
          },
          data: {
            status: error instanceof ContentValidationError ? "REVIEW" : "FAILED",
            lastError: (error as Error).message,
          }
        });
        throw error;
      }
    } else {
      this.logger.log(
        `generated ${platforms.length} drafts for ${item.id}, waiting review`,
      );
    }
  }

  async releaseForRetry(contentItemId: string, generationRevision?: number) {
    await this.prisma.contentItem.updateMany({
      where: {
        id: contentItemId,
        status: "GENERATING",
        generationRevision: generationRevision ?? 0,
      },
      data: { status: "PENDING" },
    })
  }

  async markFailed(
    contentItemId: string,
    error?: string,
    generationRevision?: number,
  ) {
    await this.prisma.contentItem.updateMany({
      where: {
        id: contentItemId,
        status: { in: ["PENDING", "GENERATING"] },
        generationRevision: generationRevision ?? 0,
      },
      data: { status: "FAILED", ...(error ? { lastError: error } : {}) },
    });
  }

  private async saveGenerationIfOwned(
    contentItemId: string,
    generationRevision: number,
    platform: string,
    content: string,
    promptVersionId: string | null,
    media: Prisma.InputJsonValue,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: "GENERATING",
          generationRevision,
        },
        data: { updatedAt: new Date() },
      });
      if (!owned.count) return false;
      await tx.generation.upsert({
        where: { contentItemId_platform: { contentItemId, platform } },
        create: {
          contentItemId,
          platform,
          content,
          promptVersionId,
          media,
        },
        update: { content, promptVersionId },
      });
      return true;
    });
  }

  private async isGenerating(contentItemId: string, generationRevision: number) {
    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { status: true, generationRevision: true },
    });
    return (
      item?.status === "GENERATING" &&
      item.generationRevision === generationRevision
    );
  }

  private async generateOne(
    platform: string,
    item: {
      source: string;
      sourceTableType: string | null;
      publishLink: string | null;
      language: string;
      contentType: string;
      title: string;
      body: string;
    },
    promptConfig: PromptConfig,
  ): Promise<{ content: string; problems: string[] }> {
    const outputLanguage = outputLanguageFor(item.language);
    let content = this.parse(
      await this.llm.complete(
        buildGenerationPrompt(promptConfig, {
          ...item,
          platform,
          language: outputLanguage,
          bodyBudget: bodyBudget(platform, item)
        }),
        promptConfig.systemPrompt,
      ),
    );

    for (let i = 0; i < GenerationService.MAX_REVISIONS; i++) {
      const composed = composeSocialPost(platform, content, item);
      const problems = validateForPlatform(platform, composed.content, content)
      if (!problems.length) return { content, problems: [] }
      this.logger.warn(
        `${platform} draft invalid (round ${i + 1}): ${problems.join("; ")}`,
      );
      content = this.parse(
        await this.llm.complete(
          buildRevisePrompt(promptConfig, {
            platform,
            content,
            problems,
            language: outputLanguage,
          }),
          promptConfig.systemPrompt,
        ),
      );
    }
    // 重写轮次用尽仍不达标：保留裸正文进入人工审核，系统后缀在预览/发布时组合。
    const finalContent = composeSocialPost(platform, content, item).content;
    return {
      content,
      problems: validateForPlatform(platform, finalContent, content),
    }
  }

  // 剥离代码围栏/前后缀杂讯后按 schema 解析
  private parse(text: string): string {
    const cleaned = text.replace(/^```(json)?\s*|\s*```$/g, "").trim();
    const jsonStr = cleaned.startsWith("{")
      ? cleaned
      : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
    const parsed = outputSchema.safeParse(JSON.parse(jsonStr));
    if (!parsed.success) throw new Error("LLM output does not match schema");
    return parsed.data.content;
  }
}
