import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_PUBLISH } from "../queues";
import { PostizModule } from "../postiz/postiz.module";
import { JobsController } from "./jobs.controller";
import { PublishProcessor } from "./publish.processor";
import { PublishService } from "./publish.service";
import { RoutingService } from "./routing.service";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_PUBLISH }), PostizModule],
  controllers: [JobsController],
  providers: [PublishService, PublishProcessor, RoutingService],
  exports: [PublishService, RoutingService],
})
export class PublishModule {}
