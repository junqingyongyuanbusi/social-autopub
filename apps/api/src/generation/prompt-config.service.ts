import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PromptVersion } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_PROMPT_CONFIG, PromptConfig } from "./prompts";

export interface PublishPromptInput {
  systemPrompt: string;
  generationTemplate: string;
  revisionTemplate: string;
  platformRules: Record<string, string>;
  typeTones: Record<string, string>;
  changeNote?: string;
}

@Injectable()
export class PromptConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<PromptConfig> {
    const active = await this.prisma.promptVersion.findFirst({
      where: { active: true },
      orderBy: [{ activatedAt: "desc" }, { version: "desc" }],
    });
    return active ? this.toConfig(active) : DEFAULT_PROMPT_CONFIG;
  }

  async list() {
    const [active, versions] = await Promise.all([
      this.getActive(),
      this.prisma.promptVersion.findMany({
        orderBy: { version: "desc" },
        take: 50,
      }),
    ]);
    return { active, versions, defaults: DEFAULT_PROMPT_CONFIG };
  }

  async publish(input: PublishPromptInput) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.promptVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });
      return tx.promptVersion.create({
        data: {
          systemPrompt: input.systemPrompt,
          generationTemplate: input.generationTemplate,
          revisionTemplate: input.revisionTemplate,
          platformRules: input.platformRules as Prisma.InputJsonValue,
          typeTones: input.typeTones as Prisma.InputJsonValue,
          changeNote: input.changeNote?.trim() || null,
          active: true,
          activatedAt: now,
        },
      });
    });
  }

  async activate(id: string) {
    const existing = await this.prisma.promptVersion.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("prompt version not found");

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.promptVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });
      return tx.promptVersion.update({
        where: { id },
        data: { active: true, activatedAt: now },
      });
    });
  }

  private toConfig(version: PromptVersion): PromptConfig {
    return {
      id: version.id,
      version: version.version,
      systemPrompt: version.systemPrompt,
      generationTemplate: version.generationTemplate,
      revisionTemplate: version.revisionTemplate,
      platformRules: version.platformRules as Record<string, string>,
      typeTones: version.typeTones as Record<string, string>,
    };
  }
}
