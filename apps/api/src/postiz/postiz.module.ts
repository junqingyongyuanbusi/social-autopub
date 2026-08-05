import { Module } from '@nestjs/common';
import { AccountSyncService } from './account-sync.service';
import { PostizOauthController } from './oauth.controller';
import { PostizClient } from './postiz.client';

@Module({
  controllers: [PostizOauthController],
  providers: [PostizClient, AccountSyncService],
  exports: [PostizClient, AccountSyncService],
})
export class PostizModule {}
