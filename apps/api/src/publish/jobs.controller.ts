import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_PUBLISH, PublishJobData } from '../queues';

// 发布记录：全部子任务流水 + 失败重试
@Controller('jobs')
@UseGuards(AdminKeyGuard)
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PUBLISH) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  @Get()
  list(@Query('status') status?: string, @Query('platform') platform?: string) {
    return this.prisma.publishJob.findMany({
      where: { ...(status ? { status } : {}), ...(platform ? { platform } : {}) },
      include: { contentItem: { select: { title: true, language: true, contentType: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const job = await this.prisma.publishJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    if (job.status !== 'failed') throw new BadRequestException(`cannot retry status=${job.status}`);

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
