import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_GENERATION, QUEUE_PUBLISH } from '../queues';
import { PublishModule } from '../publish/publish.module';
import { ComposeController } from './compose.controller';
import { ContentController } from './content.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_GENERATION }),
    BullModule.registerQueue({ name: QUEUE_PUBLISH }),
    PublishModule,
  ],
  controllers: [ContentController, ComposeController],
})
export class ContentModule {}
