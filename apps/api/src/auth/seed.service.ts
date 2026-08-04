import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

// 首个管理员种子：users 表为空且配置了 ADMIN_EMAIL/ADMIN_PASSWORD 时创建（幂等）
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const email = process.env.ADMIN_EMAIL?.toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const count = await this.prisma.user.count();
    if (count > 0) return;

    await this.prisma.user.create({
      data: { email, name: 'Admin', passwordHash: await hash(password, 10), role: 'admin' },
    });
    this.logger.log(`seeded admin user ${email}`);
  }
}
