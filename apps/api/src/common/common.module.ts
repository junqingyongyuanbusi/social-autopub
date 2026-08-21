import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { MediaDownloadService } from './media-download.service';

@Global()
@Module({
  providers: [AccessService, MediaDownloadService],
  exports: [AccessService, MediaDownloadService],
})
export class CommonModule {}
