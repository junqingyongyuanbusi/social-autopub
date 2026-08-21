import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_PUBLISH, QUEUE_PUBLISH_PREPARE } from "../queues";
import { PostizModule } from "../postiz/postiz.module";
import { NotionModule } from "../sources/notion/notion.module";
import { JobsController } from "./jobs.controller";
import { PublishProcessor } from "./publish.processor";
import { PublishPreparationProcessor } from "./publish-preparation.processor";
import { PublishService } from "./publish.service";
import { PublishRecoveryService } from "./recovery.service";
import { RoutingService } from "./routing.service";

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_PUBLISH }),
    BullModule.registerQueue({ name: QUEUE_PUBLISH_PREPARE }),
    PostizModule,
    NotionModule,
  ],
  controllers: [JobsController],
  providers: [
    PublishService,
    PublishPreparationProcessor,
    PublishProcessor,
    PublishRecoveryService,
    RoutingService,
  ],
  exports: [PublishService, RoutingService],
})
export class PublishModule {}
