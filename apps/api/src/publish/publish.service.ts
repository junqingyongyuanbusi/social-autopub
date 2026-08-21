import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { mediaRefsFromRawPayload } from '../ingest/media-identity';
import {
  PostizClient,
  PreparedPostizMedia,
} from '../postiz/postiz.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotionMediaChangedError,
  NotionService,
} from '../sources/notion/notion.service';
import {
  QUEUE_PUBLISH,
  QUEUE_PUBLISH_PREPARE,
  PublishJobData,
  PublishPrepareJobData,
} from '../queues';
import {
  composeSocialPost,
  ContentValidationError,
} from '../generation/social-post'
import { validateForPlatform } from '../generation/validators'
import { RoutingService } from './routing.service';

// 审核通过后：按路由矩阵把内容拆成发布子任务入队
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly postiz: PostizClient,
    private readonly notion: NotionService,
    @InjectQueue(QUEUE_PUBLISH_PREPARE)
    private readonly prepareQueue: Queue<PublishPrepareJobData>,
    @InjectQueue(QUEUE_PUBLISH)
    private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  async targetSnapshot(contentItemId: string, platform?: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
      include: { generations: true },
    });
    const targets: Array<{
      platform: string;
      postizIntegrationId: string;
    }> = [];
    for (const generation of item.generations) {
      if (platform && generation.platform !== platform) continue;
      const accounts = await this.routing.resolveAccounts(
        item.language,
        item.contentType,
        generation.platform,
      );
      if (accounts[0]) {
        targets.push({
          platform: generation.platform,
          postizIntegrationId: accounts[0].postizIntegrationId,
        });
      }
    }
    return targets;
  }

  async targetIntegrationIds(contentItemId: string, platform?: string) {
    const targets = await this.targetSnapshot(contentItemId, platform);
    return [...new Set(targets.map((target) => target.postizIntegrationId))];
  }

  async dispatchStoredTargets(contentItemId: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
      select: { publishTargets: true },
    });
    const targets = this.publishTargets(item.publishTargets);
    if (!targets.length) throw new Error('approved content has no stored publish targets');
    return this.dispatch(contentItemId, targets);
  }


  async dispatch(
    contentItemId: string,
    targetSnapshot?: Array<{
      platform: string;
      postizIntegrationId: string;
    }>,
  ) {
    const targets = targetSnapshot ?? (await this.targetSnapshot(contentItemId));
    if (!targets.length) throw new Error('no publish targets');
    const publishRevision = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.contentItem.updateMany({
        where: { id: contentItemId, status: 'APPROVED' },
        data: {
          status: 'PUBLISHING',
          lastError: null,
          publishRevision: { increment: 1 },
          publishTargets: targets as unknown as Prisma.InputJsonValue,
        },
      });
      if (!transitioned.count) return null;
      const item = await tx.contentItem.findUniqueOrThrow({
        where: { id: contentItemId },
        select: { publishRevision: true },
      });
      await tx.publishJob.updateMany({
        where: {
          contentItemId,
          status: { in: ['queued', 'failed'] },
        },
        data: { status: 'cancelled' },
      });
      return item.publishRevision;
    });
    if (publishRevision === null) {
      const item = await this.prisma.contentItem.findUniqueOrThrow({
        where: { id: contentItemId },
        select: { status: true },
      });
      throw new Error(`cannot dispatch content status=${item.status}`);
    }
    const prepareJobId = `prepare-${contentItemId}-r${publishRevision}`;
    try {
      await this.prepareQueue.add(
        'prepare-publish',
        { contentItemId, publishRevision },
        {
          jobId: prepareJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    } catch (error) {
      await this.prisma.contentItem.updateMany({
        where: { id: contentItemId, status: 'PUBLISHING', publishRevision },
        data: {
          lastError: `发布准备任务入队结果未知，将由 recovery 核实：${(error as Error).message}`,
        },
      });
      this.logger.error(
        `prepare enqueue outcome unknown for ${contentItemId} revision ${publishRevision}: ${(error as Error).message}`,
      );
      return 1;
    }
    return 1;
  }

  async prepare(contentItemId: string, publishRevision: number) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id: contentItemId },
      include: { generations: true },
    });

    if (
      item.status !== 'PUBLISHING' ||
      item.publishRevision !== publishRevision
    ) {
      throw new Error(`cannot prepare content status=${item.status}`);
    }
    const existingJobs = await this.prisma.publishJob.findMany({
      where: { contentItemId: item.id, publishRevision },
      select: {
        id: true,
        publishRevision: true,
        status: true,
        platform: true,
        postizIntegrationId: true,
        mediaSnapshot: true,
      },
    });
    if (
      existingJobs.some((job) =>
        ['publishing', 'unknown'].includes(job.status),
      )
    ) {
      for (const job of existingJobs) {
        if (job.status === 'queued' && job.mediaSnapshot !== null) {
          await this.enqueuePublishJob(job.id, job.publishRevision);
        }
      }
      return existingJobs.length;
    }
    if (
      existingJobs.length &&
      existingJobs.every(
        (job) => job.status === 'queued' && job.mediaSnapshot !== null,
      )
    ) {
      for (const job of existingJobs) {
        await this.enqueuePublishJob(job.id, job.publishRevision);
      }
      return existingJobs.length;
    }

    const targets = this.publishTargets(item.publishTargets);

    if (!targets.length) {
      await this.prisma.contentItem.updateMany({
        where: { id: item.id, status: { in: ['APPROVED', 'PUBLISHING'] } },
        data: { status: 'FAILED' },
      });
      return 0;
    }

    const targetPlatforms = new Set(targets.map((target) => target.platform));
    const validationProblems = item.generations
      .filter((generation) => targetPlatforms.has(generation.platform))
      .flatMap((generation) => {
        const finalContent = composeSocialPost(
          generation.platform,
          generation.content,
          item,
        ).content;
        return validateForPlatform(
          generation.platform,
          finalContent,
          generation.content,
        ).map((problem) => `${generation.platform}: ${problem}`);
      });
    if (validationProblems.length) {
      const message = validationProblems.join('；');
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: { lastError: message },
      });
      throw new ContentValidationError(message)
    }
    if (item.lastError) {
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: { lastError: null },
      });
    }
    const mediaSnapshots = await this.prepareMediaSnapshots(item, targetPlatforms);

    const jobs = await this.prisma.$transaction(async (tx) => {
      const persisted = [];
      for (const target of targets) {
        const mediaSnapshot = (mediaSnapshots.get(target.platform) ?? []) as unknown as Prisma.InputJsonValue;
        const existing = existingJobs.find(
          (job) =>
            job.platform === target.platform &&
            job.postizIntegrationId === target.postizIntegrationId,
        );
        if (existing?.status === 'sent') {
          persisted.push(existing);
          continue;
        }
        if (existing) {
          persisted.push(
            await tx.publishJob.update({
              where: { id: existing.id },
              data: { status: 'queued', error: null, mediaSnapshot },
            }),
          );
          continue;
        }
        persisted.push(
          await tx.publishJob.create({
            data: {
              contentItemId: item.id,
              publishRevision,
              platform: target.platform,
              postizIntegrationId: target.postizIntegrationId,
              scheduledAt: item.publishAt,
              mediaSnapshot,
            },
          }),
        );
      }
      return persisted;
    });

    let dispatched = 0;
    for (const job of jobs) {
      if (job.status !== 'queued') {
        dispatched++;
        continue;
      }
      try {
        await this.enqueuePublishJob(job.id, job.publishRevision);
      } catch (error) {
        this.logger.error(
          `enqueue publish job ${job.id} failed: ${(error as Error).message}`,
        );
      }
      dispatched++;
    }

    if (!dispatched) {
      await this.prisma.contentItem.updateMany({
        where: { id: item.id, status: 'PUBLISHING' },
        data: { status: 'FAILED' },
      });
    }
    return dispatched;
  }

  private enqueuePublishJob(publishJobId: string, publishRevision: number) {
    return this.publishQueue.add(
      'publish',
      { publishJobId },
      {
        jobId: `publish-${publishJobId}-r${publishRevision}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }

  private async prepareMediaSnapshots(
    item: any,
    targetPlatforms: Set<string>,
  ): Promise<Map<string, PreparedPostizMedia[]>> {
    const generations = item.generations.filter((generation: any) =>
      targetPlatforms.has(generation.platform),
    );
    const replacements = new Map<
      string,
      { url: string; buffer?: Buffer }
    >();

    if (item.source === 'notion') {
      const sourceRefs = mediaRefsFromRawPayload(item.rawPayload);
      const sourceUrls = this.stringArray(item.media);
      const generationMedia = generations.flatMap((generation: any) =>
        this.stringArray(generation.media),
      );
      if (!sourceRefs) {
        if (sourceUrls.some((url) => generationMedia.includes(url))) {
          throw new NotionMediaChangedError(
            '该草稿创建于 Notion 媒体指纹升级前，请等待来源重新摄取后审核新版本',
          );
        }
      } else {
        const refreshTargets = sourceRefs.filter((ref) =>
          generationMedia.includes(ref.url),
        );
        if (refreshTargets.length) {
          const refreshed = await this.notion.refreshMediaRefs(refreshTargets);
          refreshTargets.forEach((ref, index) => {
            replacements.set(ref.url, {
              url: refreshed[index].ref.url,
              ...(refreshed[index].buffer
                ? { buffer: refreshed[index].buffer }
                : {}),
            });
          });
        }
      }
    }

    const snapshots = new Map<string, PreparedPostizMedia[]>();
    for (const generation of generations) {
      const urls = this.stringArray(generation.media);
      if (generation.platform === 'instagram' && !urls.length) {
        throw new ContentValidationError(
          'Instagram 发布必须包含图片，请在审核工作台补充媒体后重试',
        );
      }
      const media = urls.map((url) => replacements.get(url) ?? url);
      snapshots.set(
        generation.platform,
        await this.postiz.prepareMedia(generation.platform, media),
      );
    }
    return snapshots;
  }

  private publishTargets(value: unknown): Array<{
    platform: string;
    postizIntegrationId: string;
  }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const target = entry as Record<string, unknown>;
      return typeof target.platform === 'string' &&
        typeof target.postizIntegrationId === 'string'
        ? [
            {
              platform: target.platform,
              postizIntegrationId: target.postizIntegrationId,
            },
          ]
        : [];
    });
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
}
