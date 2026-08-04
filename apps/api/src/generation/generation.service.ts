import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { PublishService } from "../publish/publish.service";
import { RoutingService } from "../publish/routing.service";
import { LlmClient } from "./llm.client";
import { PromptConfigService } from "./prompt-config.service";
import {
  buildGenerationPrompt,
  buildRevisePrompt,
  PromptConfig,
} from "./prompts";
import { validateForPlatform } from "./validators";

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

  async generateFor(contentItemId: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
    });
    await this.prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "GENERATING" },
    });

    // 目标平台：内容指定优先，否则取路由矩阵中该语言×类型已配置的平台
    const platforms = item.targetPlatforms.length
      ? item.targetPlatforms
      : await this.routing.platformsFor(item.language, item.contentType);
    if (!platforms.length) {
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: { status: "FAILED" },
      });
      throw new Error(
        `no routing platforms for ${item.language}/${item.contentType}`,
      );
    }

    const promptConfig = await this.prompts.getActive();
    for (const platform of platforms) {
      const content = await this.generateOne(platform, item, promptConfig);
      await this.prisma.generation.upsert({
        where: { contentItemId_platform: { contentItemId: item.id, platform } },
        create: {
          contentItemId: item.id,
          platform,
          content,
          promptVersionId: promptConfig.id,
          media: (item.media ?? []) as Prisma.InputJsonValue,
        },
        update: { content, promptVersionId: promptConfig.id },
      });
    }

    // AUTO_PUBLISH=true：生成完成即发布（Notion 勾选 social_media_sent 即视为人工确认）
    // 否则进入控制台人工审核
    if (process.env.AUTO_PUBLISH === "true") {
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: { status: "APPROVED" },
      });
      const dispatched = await this.publish.dispatch(item.id);
      this.logger.log(
        `auto-published ${item.id}: ${dispatched} job(s) for ${platforms.length} platform(s)`,
      );
    } else {
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: { status: "REVIEW" },
      });
      this.logger.log(
        `generated ${platforms.length} drafts for ${item.id}, waiting review`,
      );
    }
  }

  async markFailed(contentItemId: string) {
    await this.prisma.contentItem
      .update({ where: { id: contentItemId }, data: { status: "FAILED" } })
      .catch(() => undefined);
  }

  private async generateOne(
    platform: string,
    item: {
      language: string;
      contentType: string;
      title: string;
      body: string;
    },
    promptConfig: PromptConfig,
  ): Promise<string> {
    let content = this.parse(
      await this.llm.complete(
        buildGenerationPrompt(promptConfig, { platform, ...item }),
        promptConfig.systemPrompt,
      ),
    );

    for (let i = 0; i < GenerationService.MAX_REVISIONS; i++) {
      const problems = validateForPlatform(platform, content);
      if (!problems.length) return content;
      this.logger.warn(
        `${platform} draft invalid (round ${i + 1}): ${problems.join("; ")}`,
      );
      content = this.parse(
        await this.llm.complete(
          buildRevisePrompt(promptConfig, {
            platform,
            content,
            problems,
            language: item.language,
          }),
          promptConfig.systemPrompt,
        ),
      );
    }
    // 重写轮次用尽仍不达标：保留最后一版进入人工审核，由运营兜底
    return content;
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
