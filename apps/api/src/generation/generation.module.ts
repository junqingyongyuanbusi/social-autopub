import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { QUEUE_GENERATION } from "../queues";
import { GenerationRecoveryService } from "./generation-recovery.service";
import { PublishModule } from "../publish/publish.module";
import { GenerationProcessor } from "./generation.processor";
import { GenerationService } from "./generation.service";
import { LlmClient } from "./llm.client";
import { PromptConfigService } from "./prompt-config.service";

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_GENERATION }),
    PublishModule,
  ],
  providers: [
    GenerationService,
    GenerationRecoveryService,
    GenerationProcessor,
    LlmClient,
    PromptConfigService,
  ],
  exports: [PromptConfigService],
})
export class GenerationModule {}
