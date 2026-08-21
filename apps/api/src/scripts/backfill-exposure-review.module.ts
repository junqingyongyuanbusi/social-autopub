import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { IngestService } from "../ingest/ingest.service";
import { PrismaModule } from "../prisma/prisma.module";
import { QUEUE_GENERATION } from "../queues";
import { RedisModule } from "../redis/redis.module";
import { NotionPoller } from "../sources/notion/notion.poller";
import { NotionService } from "../sources/notion/notion.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    BullModule.registerQueue({ name: QUEUE_GENERATION }),
    PrismaModule,
    RedisModule,
  ],
  providers: [IngestService, NotionService, NotionPoller],
})
export class BackfillExposureReviewModule {}
