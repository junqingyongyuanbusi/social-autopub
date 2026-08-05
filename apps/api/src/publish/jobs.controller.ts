import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_PUBLISH, PublishJobData } from '../queues';

// 发布记录：非 admin 按其关联账号的 integration 过滤
@Controller('jobs')
@UseGuards(AdminKeyGuard)
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    @InjectQueue(QUEUE_PUBLISH) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ) {
    const integrationIds = await this.access.visibleIntegrationIds(user);
    if (integrationIds !== null && !integrationIds.length) return [];
    return this.prisma.publishJob.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(platform ? { platform } : {}),
        ...(integrationIds !== null ? { postizIntegrationId: { in: integrationIds } } : {}),
      },
      include: { contentItem: { select: { title: true, language: true, contentType: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post(':id/retry')
  async retry(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const job = await this.prisma.publishJob.findUnique({ where: { id }, include: { contentItem: true } });
    if (!job) throw new NotFoundException();
    if (job.status !== 'failed') throw new BadRequestException(`cannot retry status=${job.status}`);
    await this.access.assertPermission(user, job.contentItem.language, 'canPublish');

    await this.prisma.publishJob.update({ where: { id }, data: { status: 'queued', error: null } });
    await this.prisma.contentItem.update({ where: { id: job.contentItemId }, data: { status: 'PUBLISHING' } });
    await this.publishQueue.add(
      'publish',
      { publishJobId: id },
      { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
    );
    return { ok: true };
  }
}
