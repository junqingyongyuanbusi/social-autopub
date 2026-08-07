import { Module } from '@nestjs/common';
import { IngestModule } from '../../ingest/ingest.module';
import { RedisModule } from '../../redis/redis.module';
import { NotionPoller } from './notion.poller';
import { NotionService } from './notion.service';

@Module({
  imports: [IngestModule, RedisModule],
  providers: [NotionService, NotionPoller],
  exports: [NotionService, NotionPoller],
})
export class NotionModule {}
