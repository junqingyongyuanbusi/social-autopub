import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_GENERATION } from '../queues';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_GENERATION })],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
