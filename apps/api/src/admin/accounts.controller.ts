import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AccountSyncService } from '../postiz/account-sync.service';

// 账号健康：Postiz integrations 的本地镜像，支持手动触发同步
@Controller('accounts')
@UseGuards(AdminKeyGuard)
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: AccountSyncService,
  ) {}

  @Get()
  list() {
    return this.prisma.account.findMany({ orderBy: [{ platform: 'asc' }, { name: 'asc' }] });
  }

  @Post('sync')
  async syncNow() {
    await this.sync.sync();
    return this.list();
  }
}
