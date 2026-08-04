import { Module } from '@nestjs/common';
import { AccountSyncService } from './account-sync.service';
import { PostizClient } from './postiz.client';

@Module({
  providers: [PostizClient, AccountSyncService],
  exports: [PostizClient, AccountSyncService],
})
export class PostizModule {}
