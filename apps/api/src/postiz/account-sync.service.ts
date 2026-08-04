import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PostizClient } from './postiz.client';

// 每 30 分钟把 Postiz integrations 同步为本地 accounts（账号健康页数据源）
@Injectable()
export class AccountSyncService {
  private readonly logger = new Logger(AccountSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly postiz: PostizClient,
  ) {}

  @Cron('*/30 * * * *')
  async sync() {
    if (!process.env.POSTIZ_API_URL) return;
    const integrations = await this.postiz.getIntegrations();
    const now = new Date();
    for (const it of integrations) {
      await this.prisma.account.upsert({
        where: { postizIntegrationId: it.id },
        create: {
          postizIntegrationId: it.id,
          platform: it.identifier,
          name: it.name,
          status: it.disabled ? 'disconnected' : 'active',
          lastSyncedAt: now,
        },
        update: { name: it.name, status: it.disabled ? 'disconnected' : 'active', lastSyncedAt: now },
      });
    }
    // 本地有但 Postiz 已不存在的账号 → 标记失联
    await this.prisma.account.updateMany({
      where: { lastSyncedAt: { lt: now } },
      data: { status: 'disconnected' },
    });
    this.logger.log(`synced ${integrations.length} integrations`);
  }
}
