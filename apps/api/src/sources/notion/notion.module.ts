import { Module } from '@nestjs/common';
import { IngestModule } from '../../ingest/ingest.module';
import { NotionPoller } from './notion.poller';
import { NotionService } from './notion.service';

@Module({
  imports: [IngestModule],
  providers: [NotionService, NotionPoller],
  exports: [NotionService, NotionPoller],
})
export class NotionModule {}
