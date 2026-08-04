import { Module } from "@nestjs/common";
import { PublishModule } from "../publish/publish.module";
import { GenerationProcessor } from "./generation.processor";
import { GenerationService } from "./generation.service";
import { LlmClient } from "./llm.client";
import { PromptConfigService } from "./prompt-config.service";

@Module({
  imports: [PublishModule],
  providers: [
    GenerationService,
    GenerationProcessor,
    LlmClient,
    PromptConfigService,
  ],
  exports: [PromptConfigService],
})
export class GenerationModule {}
