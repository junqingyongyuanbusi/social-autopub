import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';

// 总览统计：按状态计数 + 近 7 日各平台发布量 + 最近失败
@Controller('stats')
@UseGuards(AdminKeyGuard)
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview() {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [byStatus, jobsByPlatform, recentFailures] = await Promise.all([
      this.prisma.contentItem.groupBy({ by: ['status'], _count: true }),
      this.prisma.publishJob.groupBy({
        by: ['platform', 'status'],
        _count: true,
        where: { createdAt: { gte: since } },
      }),
      this.prisma.publishJob.findMany({
        where: { status: 'failed' },
        include: { contentItem: { select: { title: true, language: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);
    return { byStatus, jobsByPlatform, recentFailures };
  }
}
