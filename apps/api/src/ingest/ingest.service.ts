import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_GENERATION, GenerationJobData } from '../queues';
import {
  EXPOSURE_REVIEW_LINK_ERROR_PREFIX,
  exposureReviewLinkProblem,
} from '../generation/social-post'
import { IngestPayload } from './ingest.schema';
import {
  bindMediaRefsToStoredUrls,
  DeferredNotionIngestError,
  mediaRefsFromRawPayload,
  mediaUrls,
  sameMediaUrls,
  sourceMediaIdentity,
  SourceMediaRef,
} from './media-identity';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

// 统一入库口：Notion 轮询与 HTTP ingest 都经此进入同一状态机
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_GENERATION)
    private readonly generationQueue: Queue<GenerationJobData>,
  ) {}

  async upsert(
    source: string,
    payload: IngestPayload,
    options?: { rawPayload?: unknown; sourceMedia?: SourceMediaRef[] },
  ) {
    const sourceMedia = options?.sourceMedia;
    const mediaFingerprint =
      source === 'notion' && sourceMedia !== undefined
        ? sourceMediaIdentity(sourceMedia)
        : null;
    let forceReviewForLegacyCutover = false;
    const contentHashInput =
      source === 'wikifx'
        ? canonicalJson({
            body: payload.body,
            content_type: payload.content_type,
            language: payload.language,
            media: payload.media,
            publish_at: payload.publish_at ?? null,
            target_platforms: payload.target_platforms,
            title: payload.title,
          })
        : source === 'notion' && sourceMedia !== undefined
          ? payload.title + payload.body + mediaFingerprint
          : payload.title + payload.body + payload.media.join(',');
    const contentHash = createHash('sha256').update(contentHashInput)
      .digest('hex')
      .slice(0, 16);

    let rawPayload = JSON.parse(JSON.stringify(options?.rawPayload ?? payload));
    let existing = await this.prisma.contentItem.findUnique({
      where: {
        source_externalId_contentHash: {
          source,
          externalId: payload.external_id,
          contentHash,
        },
      },
      include: { jobs: { select: { id: true } } },
    });
    if (!existing && source === 'notion' && sourceMedia !== undefined) {
      const preferred = await this.findPreferredNotionEquivalent(
        payload.external_id,
        payload.title,
        payload.body,
        sourceMedia,
      );
      if (preferred?.mediaFingerprint === mediaFingerprint) {
        existing = preferred;
      } else if (
        preferred &&
        mediaFingerprint &&
        sameMediaUrls(this.stringArray(preferred.media), mediaUrls(sourceMedia))
      ) {
        const reboundRefs = bindMediaRefsToStoredUrls(
          sourceMedia,
          this.stringArray(preferred.media),
        );
        rawPayload = this.rawPayloadWithMediaRefs(rawPayload, reboundRefs);
        await this.prisma.contentItem.updateMany({
          where: { id: preferred.id, mediaFingerprint: null },
          data: { mediaFingerprint, rawPayload },
        });
        existing = preferred;
        this.logger.warn(
          `safely bootstrapped stable Notion media on unchanged legacy item ${preferred.id}`,
        );
      } else if (preferred && this.isActiveLegacy(preferred)) {
        throw new DeferredNotionIngestError(
          `legacy Notion item ${preferred.id} is still in flight; retry media cutover after it reaches a terminal state`,
        );
      } else if (preferred) {
        forceReviewForLegacyCutover = true;
        this.logger.warn(
          `legacy Notion item ${preferred.id} requires a reviewed stable-media version`,
        );
      } else if (
        mediaFingerprint &&
        (await this.hasProtectedNotionMediaChange(
          payload.external_id,
          payload.title,
          payload.body,
          mediaFingerprint,
        ))
      ) {
        forceReviewForLegacyCutover = true;
        this.logger.warn(
          `Notion media changed after a protected version; new item requires review`,
        );
      }
    }
    if (existing) {
      if (
        source === 'notion' &&
        sourceMedia !== undefined &&
        existing.mediaFingerprint === mediaFingerprint
      ) {
        const persistedRefs = mediaRefsFromRawPayload(existing.rawPayload);
        if (persistedRefs) {
          const refreshedRefs = bindMediaRefsToStoredUrls(
            sourceMedia,
            mediaUrls(persistedRefs),
          );
          if (JSON.stringify(refreshedRefs) !== JSON.stringify(persistedRefs)) {
            rawPayload = this.rawPayloadWithMediaRefs(rawPayload, refreshedRefs);
            await this.prisma.contentItem.updateMany({
              where: { id: existing.id, mediaFingerprint },
              data: { rawPayload },
            });
          }
        }
      }
      const mutable =
        ['PENDING', 'REVIEW', 'FAILED'].includes(existing.status) &&
        existing.jobs.length === 0;
      if (!mutable) return existing;

      const isExposureReview =
        source === 'notion' && payload.source_table_type === 'exposure-review';
      if (!isExposureReview) {
        await this.ensureGenerationJob(
          existing.id,
          existing.status,
          existing.generationRevision,
        );
        return existing;
      }
      const nextSourceTableType = payload.source_table_type ?? null;
      const nextPublishLink = payload.publish_link ?? null;
      const linkProblem = exposureReviewLinkProblem({
        source,
        sourceTableType: nextSourceTableType,
        publishLink: nextPublishLink,
        language: payload.language,
        contentType: payload.content_type,
      });
      const metadataChanged =
        existing.sourceTableType !== nextSourceTableType ||
        existing.publishLink !== nextPublishLink ||
        existing.contentType !== payload.content_type ||
        existing.language !== payload.language;
      const metadata: Prisma.ContentItemUpdateManyMutationInput = {
        language: payload.language,
        contentType: payload.content_type,
        sourceTableType: nextSourceTableType,
        publishLink: nextPublishLink,
        rawPayload,
      };
      if (linkProblem) {
        await this.failForInvalidMetadata(existing.id, metadata, linkProblem)
        return (await this.findById(existing.id))!;
      }

      const wasLinkFailure = existing.lastError?.startsWith(
        EXPOSURE_REVIEW_LINK_ERROR_PREFIX,
      );
      if (metadataChanged || wasLinkFailure) {
        await this.requeueForMetadataRefresh(existing.id, metadata, true);
      } else {
        await this.ensureGenerationJob(
          existing.id,
          existing.status,
          existing.generationRevision,
        );
      }
      return (await this.findById(existing.id))!;
    }

    // 同源同 id 出现新版本：作废尚未进入发布流程的旧任务，防止新旧两版都发出去
    // （APPROVED/PUBLISHING 已在发布通道中，不强行撤回，由运营在发布记录页处理）
    const superseded = await this.prisma.contentItem.updateMany({
      where: {
        source,
        externalId: payload.external_id,
        contentHash: { not: contentHash },
        status: { in: ['PENDING', 'GENERATING', 'REVIEW'] },
      },
      data: { status: 'SUPERSEDED' },
    });
    if (superseded.count) {
      this.logger.log(
        `superseded ${superseded.count} stale item(s) of ${source}:${payload.external_id}`,
      );
    }

    const initialLinkProblem = exposureReviewLinkProblem({
      source,
      sourceTableType: payload.source_table_type ?? null,
      publishLink: payload.publish_link ?? null,
      language: payload.language,
      contentType: payload.content_type,
    })
    let item: Awaited<ReturnType<PrismaService['contentItem']['create']>>;
    try {
      item = await this.prisma.contentItem.create({
        data: {
          source,
          externalId: payload.external_id,
          contentHash,
          mediaFingerprint,
          language: payload.language,
          contentType: payload.content_type,
          title: payload.title,
          body: payload.body,
          media: payload.media,
          targetPlatforms: payload.target_platforms,
          publishAt: payload.publish_at ? new Date(payload.publish_at) : null,
          sourceTableType: payload.source_table_type ?? null,
          publishLink: payload.publish_link ?? null,
          status: initialLinkProblem ? 'FAILED' : 'PENDING',
          lastError:
            initialLinkProblem ??
            (forceReviewForLegacyCutover
              ? 'Notion 媒体指纹升级：请确认当前图片后再发布'
              : null),
          forceReview: Boolean(initialLinkProblem) || forceReviewForLegacyCutover,
          rawPayload,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const concurrent = await this.prisma.contentItem.findUniqueOrThrow({
        where: {
          source_externalId_contentHash: {
            source,
            externalId: payload.external_id,
            contentHash,
          },
        },
      });
      await this.ensureGenerationJob(
        concurrent.id,
        concurrent.status,
        concurrent.generationRevision,
      )
      return concurrent;
    }

    // 入队失败不删除已持久化 item，后续相同 upsert 可补投
    await this.ensureGenerationJob(item.id, item.status, item.generationRevision)
    this.logger.log(`ingested ${source}:${payload.external_id} -> ${item.id}`);
    return item;
  }

  async findPreferredNotionEquivalent(
    externalId: string,
    title: string,
    body: string,
    sourceMedia: SourceMediaRef[],
  ) {
    const candidates = await this.prisma.contentItem.findMany({
      where: { source: 'notion', externalId },
      include: { jobs: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const incomingFingerprint = sourceMediaIdentity(sourceMedia);
    const eligible = candidates.filter(
      (candidate) =>
        candidate.title === title &&
        candidate.body === body &&
        !['SUPERSEDED', 'REJECTED'].includes(candidate.status),
    );
    const canonical = eligible.find(
      (candidate) =>
        candidate.mediaFingerprint || mediaRefsFromRawPayload(candidate.rawPayload),
    );
    if (canonical) {
      const canonicalFingerprint =
        canonical.mediaFingerprint ??
        sourceMediaIdentity(mediaRefsFromRawPayload(canonical.rawPayload) ?? []);
      return canonicalFingerprint === incomingFingerprint ? canonical : undefined;
    }
    return this.preferredEquivalent(eligible);
  }

  private async hasProtectedNotionMediaChange(
    externalId: string,
    title: string,
    body: string,
    incomingFingerprint: string,
  ): Promise<boolean> {
    const candidates = await this.prisma.contentItem.findMany({
      where: {
        source: 'notion',
        externalId,
        title,
        body,
        mediaFingerprint: { not: null },
      },
      include: { jobs: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return candidates.some(
      (candidate) =>
        candidate.mediaFingerprint !== incomingFingerprint &&
        this.isPublishProtected(candidate),
    );
  }

  findById(id: string) {
    return this.prisma.contentItem.findUnique({
      where: { id },
      include: { jobs: true },
    });
  }

  async failForInvalidMetadata(
    contentItemId: string,
    metadata: Prisma.ContentItemUpdateManyMutationInput,
    error: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: { in: ['PENDING', 'REVIEW', 'FAILED'] },
          jobs: { none: {} },
        },
        data: {
          ...metadata,
          status: 'FAILED',
          lastError: error,
          forceReview: true,
          generationRevision: { increment: 1 },
        },
      });
      if (!updated.count) return false;
      await tx.generation.deleteMany({ where: { contentItemId } });
      return true;
    });
  }

  async ensurePendingGenerationJob(contentItemId: string, forceReview = false) {
    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        status: true,
        generationRevision: true,
        forceReview: true,
        _count: { select: { jobs: true } },
      },
    });
    if (!item || item.status !== 'PENDING' || item._count.jobs > 0) return false;
    await this.ensureGenerationJob(
      contentItemId,
      item.status,
      item.generationRevision,
      forceReview || item.forceReview,
    );
    return true;
  }

  async requeueForMetadataRefresh(
    contentItemId: string,
    metadata: Prisma.ContentItemUpdateManyMutationInput = {},
    forceReview = true,
  ) {
    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        status: true,
        generationRevision: true,
        _count: { select: { jobs: true } },
      },
    });
    if (
      !item ||
      item._count.jobs > 0 ||
      !['PENDING', 'REVIEW', 'FAILED'].includes(item.status)
    )
      return false

    const revision = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentItem.updateMany({
        where: {
          id: contentItemId,
          status: { in: ['PENDING', 'REVIEW', 'FAILED'] },
          jobs: { none: {} },
        },
        data: {
          ...metadata,
          status: 'PENDING',
          lastError: null,
          generationRevision: { increment: 1 },
          ...(forceReview ? { forceReview: true } : {})
        },
      });
      if (!updated.count) return null;
      await tx.generation.deleteMany({ where: { contentItemId } });
      const refreshed = await tx.contentItem.findUniqueOrThrow({
        where: { id: contentItemId },
        select: { generationRevision: true },
      });
      return refreshed.generationRevision;
    });
    if (revision === null) return false;
    await this.ensureGenerationJob(contentItemId, 'PENDING', revision, forceReview);
    return true;
  }

  private isPublishProtected(candidate: {
    status: string;
    forceReview?: boolean;
    jobs: Array<{ id: string; status?: string }>;
  }): boolean {
    return (
      candidate.forceReview === true ||
      candidate.jobs.length > 0 ||
      ['GENERATING', 'APPROVED', 'PUBLISHING', 'PUBLISHED'].includes(
        candidate.status,
      )
    );
  }

  private isActiveLegacy(candidate: {
    status: string;
    jobs: Array<{ id: string; status?: string }>;
  }): boolean {
    return (
      ['GENERATING', 'APPROVED', 'PUBLISHING'].includes(candidate.status) ||
      candidate.jobs.some((job) =>
        ['queued', 'publishing'].includes(job.status ?? ''),
      )
    );
  }

  private preferredEquivalent<
    T extends {
      status: string;
      jobs: Array<{ id: string; status?: string }>;
      createdAt: Date;
    },
  >(candidates: T[]): T | undefined {
    const protectedCandidates = candidates.filter((candidate) =>
      this.isPublishProtected(candidate),
    );
    return (protectedCandidates.length ? protectedCandidates : candidates)[0];
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private rawPayloadWithMediaRefs(
    rawPayload: unknown,
    mediaRefs: SourceMediaRef[],
  ): Prisma.InputJsonValue {
    const base =
      rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : {};
    return JSON.parse(JSON.stringify({ ...base, mediaRefs }));
  }

  private async ensureGenerationJob(
    contentItemId: string,
    status: string,
    generationRevision: number,
    forceReview = false,
  ) {
    if (status !== 'PENDING') return;
    await this.generationQueue.add(
      'generate',
      { contentItemId, forceReview, generationRevision },
      {
        jobId: `generation-${contentItemId}-r${generationRevision}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  }
}
