import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AccountSyncService } from './account-sync.service';
import { InstagramImageService } from './instagram-image.service';
import { PostizOauthController } from './oauth.controller';
import { PostizClient } from './postiz.client';
import { PostizRateGate } from './postiz-rate-gate.service';

@Module({
  imports: [RedisModule],
  controllers: [PostizOauthController],
  providers: [
    PostizClient,
    PostizRateGate,
    AccountSyncService,
    InstagramImageService,
  ],
  exports: [PostizClient, AccountSyncService, InstagramImageService],
})
export class PostizModule {}
