import { Module } from '@nestjs/common';
import { IngestModule } from '../../ingest/ingest.module';
import { RedisModule } from '../../redis/redis.module';
import { WikifxClient } from './wikifx.client';
import { WikifxController } from './wikifx.controller';
import { WikifxService } from './wikifx.service';

@Module({
  imports: [IngestModule, RedisModule],
  controllers: [WikifxController],
  providers: [WikifxClient, WikifxService],
})
export class WikifxModule {}
