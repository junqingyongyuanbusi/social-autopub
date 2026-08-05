import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';

// 总览统计：非 admin 按可见语言/账号过滤
@Controller('stats')
@UseGuards(AdminKeyGuard)
export class StatsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: RequestUser) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [languages, integrationIds] = await Promise.all([
      this.access.visibleLanguages(user),
      this.access.visibleIntegrationIds(user),
    ]);
    const contentWhere = languages !== null ? { language: { in: languages } } : {};
    const jobWhere = integrationIds !== null ? { postizIntegrationId: { in: integrationIds } } : {};

    const [byStatus, jobsByPlatform, recentFailures] = await Promise.all([
      this.prisma.contentItem.groupBy({ by: ['status'], _count: true, where: contentWhere }),
      this.prisma.publishJob.groupBy({
        by: ['platform', 'status'],
        _count: true,
        where: { createdAt: { gte: since }, ...jobWhere },
      }),
      this.prisma.publishJob.findMany({
        where: { status: 'failed', ...jobWhere },
        include: { contentItem: { select: { title: true, language: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);
    return { byStatus, jobsByPlatform, recentFailures };
  }
}
