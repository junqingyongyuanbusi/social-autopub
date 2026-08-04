import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AdminKeyGuard } from "../common/admin-key.guard";
import { PromptConfigService } from "../generation/prompt-config.service";

const rulesSchema = z.record(z.string().min(1), z.string());
const publishSchema = z.object({
  systemPrompt: z.string().max(20_000),
  generationTemplate: z.string().min(1).max(30_000),
  revisionTemplate: z.string().min(1).max(30_000),
  platformRules: rulesSchema,
  typeTones: rulesSchema,
  changeNote: z.string().max(500).optional(),
});

const REQUIRED_GENERATION_TOKENS = ["platform", "language", "title", "body"];
const REQUIRED_REVISION_TOKENS = [
  "platform",
  "language",
  "content",
  "problems",
];

@Controller("prompts")
@UseGuards(AdminKeyGuard)
export class PromptsController {
  constructor(private readonly prompts: PromptConfigService) {}

  @Get()
  list() {
    return this.prompts.list();
  }

  @Post()
  publish(@Body() body: unknown) {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    this.assertTokens(
      parsed.data.generationTemplate,
      REQUIRED_GENERATION_TOKENS,
      "generationTemplate",
    );
    this.assertTokens(
      parsed.data.revisionTemplate,
      REQUIRED_REVISION_TOKENS,
      "revisionTemplate",
    );
    return this.prompts.publish(parsed.data);
  }

  @Post(":id/activate")
  activate(@Param("id") id: string) {
    return this.prompts.activate(id);
  }

  private assertTokens(template: string, tokens: string[], field: string) {
    const missing = tokens.filter(
      (token) => !template.includes(`{{${token}}}`),
    );
    if (missing.length) {
      throw new BadRequestException(
        `${field} 缺少变量：${missing.map((token) => `{{${token}}}`).join(", ")}`,
      );
    }
  }
}
