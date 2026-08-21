import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_PUBLISH, PublishJobData } from '../queues';
import { concludePublishRevision } from './finalize-revision';

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

  @Post(':id/resolve-unknown')
  async resolveUnknown(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { outcome?: unknown; postizPostId?: unknown },
  ) {
    const job = await this.prisma.publishJob.findUnique({
      where: { id },
      include: { contentItem: true },
    });
    if (!job) throw new NotFoundException();
    if (body.outcome !== 'sent' && body.outcome !== 'failed') {
      throw new BadRequestException('outcome must be sent or failed');
    }
    if (
      body.outcome === 'sent' &&
      (typeof body.postizPostId !== 'string' || !body.postizPostId.trim())
    ) {
      throw new BadRequestException('postizPostId required when confirming sent');
    }
    const postizPostId =
      typeof body.postizPostId === 'string' ? body.postizPostId.trim() : null;
    if (job.status !== 'unknown') {
      throw new BadRequestException(`cannot resolve status=${job.status}`);
    }
    if (job.publishRevision !== job.contentItem.publishRevision) {
      throw new BadRequestException('cannot resolve stale publish revision');
    }
    await this.access.assertIntegrationPermission(
      user,
      job.postizIntegrationId,
      'canPublish',
    );
    const status = await this.prisma.$transaction(async (tx) => {
      const resolved = await tx.publishJob.updateMany({
        where: { id, status: 'unknown', publishRevision: job.publishRevision },
        data:
          body.outcome === 'sent'
            ? {
                status: 'sent',
                postizPostId,
                error: null,
              }
            : { status: 'failed', error: '人工核实：未发送，可安全重试' },
      });
      if (!resolved.count) {
        throw new BadRequestException('unknown outcome was already resolved');
      }
      const conclusion = await concludePublishRevision(
        tx,
        job.contentItemId,
        job.publishRevision,
      );
      // 批内仍有在途子任务时内容维持 PUBLISHING，等其余子任务收敛
      return conclusion.outcome ?? 'PUBLISHING';
    });
    return { ok: true, status };
  }

  @Post(':id/retry')
  async retry(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const job = await this.prisma.publishJob.findUnique({ where: { id }, include: { contentItem: true } });
    if (!job) throw new NotFoundException();
    if (job.status !== 'failed') throw new BadRequestException(`cannot retry status=${job.status}`);
    if (job.publishRevision !== job.contentItem.publishRevision) {
      throw new BadRequestException('cannot retry stale publish revision');
    }
    if (job.contentItem.status !== 'FAILED') {
      throw new BadRequestException(
        `cannot retry while content status=${job.contentItem.status}`,
      );
    }
    await this.access.assertIntegrationPermission(
      user,
      job.postizIntegrationId,
      'canPublish',
    );

    const bullJobId = `publish-${id}-r${job.publishRevision}`;
    const existingBullJob = await this.publishQueue.getJob(bullJobId);
    if (existingBullJob) {
      const state = await existingBullJob.getState();
      if (
        ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(
          state,
        )
      ) {
        throw new BadRequestException(`publish job is still ${state}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contentItem.updateMany({
        where: {
          id: job.contentItemId,
          status: 'FAILED',
          publishRevision: job.publishRevision,
        },
        data: { status: 'PUBLISHING' },
      });
      if (!claimed.count) {
        throw new BadRequestException('content is no longer retryable');
      }
      const reset = await tx.publishJob.updateMany({
        where: { id, status: 'failed', publishRevision: job.publishRevision },
        data: { status: 'queued', error: null },
      });
      if (!reset.count) {
        throw new BadRequestException('publish job is no longer retryable');
      }
    });
    if (existingBullJob) await existingBullJob.remove();
    await this.publishQueue.add(
      'publish',
      { publishJobId: id },
      {
        jobId: bullJobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
    return { ok: true };
  }
}
