import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { AdminRoleGuard } from '../common/admin-role.guard';
import { AccessService } from '../common/access.service';
import { CurrentUser, RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { PublishService } from '../publish/publish.service';
import { QUEUE_GENERATION, QUEUE_PUBLISH, GenerationJobData, PublishJobData } from '../queues';
import { composeSocialPost } from '../generation/social-post'

// 控制台 BFF：内容队列 / 审核工作台。非 admin 用户按其关联账号覆盖的语言过滤
@Controller('contents')
@UseGuards(AdminKeyGuard)
export class ContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PublishService,
    private readonly access: AccessService,
    @InjectQueue(QUEUE_GENERATION) private readonly generationQueue: Queue<GenerationJobData>,
    @InjectQueue(QUEUE_PUBLISH) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  // 清空积压（仅 admin）：默认删除未发布任务；?all=true 连历史一并全清
  @Post('purge')
  @UseGuards(AdminRoleGuard)
  async purge(@Query('all') all?: string) {
    await this.generationQueue.drain(true);
    await this.publishQueue.drain(true);
    const deleted = await this.prisma.contentItem.deleteMany({
      where: all === 'true' ? {} : { status: { notIn: ['PUBLISHED', 'PUBLISHING'] } },
    });
    await this.prisma.sourceDatabase.updateMany({ data: { lastPolledAt: null } });
    return { deleted: deleted.count };
  }

  // 批量把生成失败的内容重回生成队列（仅 admin）
  @Post('requeue-failed')
  @UseGuards(AdminRoleGuard)
  async requeueFailed() {
    const failed = await this.prisma.contentItem.findMany({
      // 手动撰写的内容没有源文可供 LLM 重新生成，重跑会直接删掉运营自己写的文案
      where: {
        status: 'FAILED',
        jobs: { none: {} },
        source: { not: 'manual' },
      },
      select: { id: true, forceReview: true },
    });
    let requeued = 0;
    let enqueueFailed = 0;
    for (const { id, forceReview } of failed) {
      const revision = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.contentItem.updateMany({
          where: {
            id,
            status: 'FAILED',
            jobs: { none: {} },
            source: { not: 'manual' },
          },
          data: {
            status: 'PENDING',
            lastError: null,
            generationRevision: { increment: 1 },
          },
        });
        if (!claimed.count) return null;
        await tx.generation.deleteMany({ where: { contentItemId: id } });
        return tx.contentItem.findUniqueOrThrow({
          where: { id },
          select: { generationRevision: true },
        });
      });
      if (!revision) continue;
      try {
        await this.generationQueue.add(
          'generate',
          { contentItemId: id, forceReview, generationRevision: revision.generationRevision },
          {
            jobId: `generation-${id}-r${revision.generationRevision}`,
            attempts: 2,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        );
        requeued++;
      } catch (error) {
        enqueueFailed++;
        await this.prisma.contentItem.updateMany({
          where: {
            id,
            status: 'PENDING',
            generationRevision: revision.generationRevision,
          },
          data: { status: 'FAILED', lastError: (error as Error).message },
        });
      }
    }
    return { requeued, enqueueFailed };
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('language') language?: string,
    @Query('contentType') contentType?: string,
    @Query('source') source?: string,
  ) {
    const visibility = await this.buildVisibilityWhere(user);
    if (visibility === null) return [];
    return this.prisma.contentItem.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(language ? { language } : {}),
        ...(contentType ? { contentType } : {}),
        ...(source ? { source } : {}),
        ...visibility,
      },
      include: { generations: true, jobs: true },
      omit: { rawPayload: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get(':id')
  async detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const item = await this.prisma.contentItem.findUnique({
      where: { id },
      include: { generations: true, jobs: true },
    });
    if (!item) throw new NotFoundException();
    if (!(await this.isVisibleTo(user, item))) throw new NotFoundException();
    const composedItem = {
      ...item,
      generations: item.generations.map((generation) => {
        try {
          const composed = composeSocialPost(generation.platform, generation.content, item);
          return {
            ...generation,
            systemSuffix: composed.suffix,
            finalContent: composed.content,
            measuredLength: composed.measuredLength,
            platformLimit: composed.limit,
            previewProblem: null,
          };
        } catch (error) {
          return {
            ...generation,
            systemSuffix: "",
            finalContent: generation.content,
            measuredLength: generation.content.length,
            platformLimit: null,
            previewProblem: (error as Error).message,
          };
        }
      }),
    };
    if (item.source !== 'wikifx') return composedItem

    const rawPayload = item.rawPayload as { article?: Record<string, unknown> } | null;
    const article = rawPayload?.article;
    return {
      ...composedItem,
      rawPayload: article
        ? {
            article: {
              article_url: article.article_url,
              content_country: article.content_country,
              content_region: article.content_region,
              view_count: article.view_count,
              active_users: article.active_users,
              avg_engagement_seconds: article.avg_engagement_seconds,
              click_count: article.click_count,
              read_count: article.read_count,
            },
          }
        : null,
    };
  }

  // 审核工作台行内编辑某平台文案（需 canEdit）
  @Patch(':id/generations/:platform')
  async editGeneration(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('platform') platform: string,
    @Body() body: { content?: string; media?: string[] },
  ) {
    if (!body.content?.trim()) throw new BadRequestException('content required');
    const item = await this.prisma.contentItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== 'REVIEW') {
      throw new BadRequestException(`cannot edit generation status=${item.status}`);
    }
    const integrationIds = await this.publish.targetIntegrationIds(id, platform);
    if (integrationIds.length) {
      for (const integrationId of integrationIds) {
        await this.access.assertIntegrationPermission(user, integrationId, 'canEdit');
      }
    } else {
      await this.access.assertPermission(user, item.language, 'canEdit');
    }
    const updated = await this.prisma.generation.updateMany({
      where: {
        contentItemId: id,
        platform,
        contentItem: { status: 'REVIEW' },
      },
      data: { content: body.content, ...(body.media ? { media: body.media } : {}) },
    });
    if (!updated.count) {
      throw new BadRequestException('content is no longer awaiting review');
    }
    return this.prisma.generation.findUniqueOrThrow({
      where: { contentItemId_platform: { contentItemId: id, platform } },
    })
  }

  // 单条重新生成（需 canEdit）
  @Post(':id/regenerate')
  async regenerate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const item = await this.prisma.contentItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    // 手动撰写的内容由运营自己写、自己配图，没有可重新生成的源文
    if (item.source === 'manual') {
      throw new BadRequestException('手动撰写的内容不支持重新生成');
    }
    if (!['FAILED', 'REJECTED', 'REVIEW'].includes(item.status)) {
      throw new BadRequestException(`cannot regenerate status=${item.status}`);
    }
    await this.access.assertPermission(user, item.language, 'canEdit');
    const revision = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contentItem.updateMany({
        where: {
          id,
          status: { in: ['FAILED', 'REJECTED', 'REVIEW'] },
          jobs: { none: {} },
        },
        data: {
          status: 'PENDING',
          lastError: null,
          generationRevision: { increment: 1 },
        },
      });
      if (!claimed.count) return null;
      await tx.generation.deleteMany({ where: { contentItemId: id } });
      return tx.contentItem.findUniqueOrThrow({
        where: { id },
        select: { generationRevision: true, forceReview: true },
      });
    });
    if (!revision) throw new BadRequestException('content is no longer eligible for regeneration');
    try {
      await this.generationQueue.add(
        'generate',
        {
          contentItemId: id,
          forceReview: revision.forceReview,
          generationRevision: revision.generationRevision,
        },
        {
          jobId: `generation-${id}-r${revision.generationRevision}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    } catch (error) {
      await this.prisma.contentItem.updateMany({
        where: {
          id,
          status: 'PENDING',
          generationRevision: revision.generationRevision,
        },
        data: { status: 'FAILED', lastError: (error as Error).message },
      });
      throw error;
    }
    return { ok: true };
  }

  @Post(':id/approve')
  async approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({
      where: { id },
      include: { generations: { select: { platform: true } } },
    });
    if (item.status !== 'REVIEW') throw new BadRequestException(`cannot approve status=${item.status}`);
    const targets = await this.publish.targetSnapshot(id);
    if (!targets.length) {
      throw new BadRequestException('cannot approve without publish targets');
    }
    const targetPlatforms = new Set(targets.map((target) => target.platform));
    const missingPlatforms = [
      ...new Set(item.generations.map((generation) => generation.platform)),
    ].filter((platform) => !targetPlatforms.has(platform));
    if (missingPlatforms.length) {
      throw new BadRequestException(
        `cannot approve without publish targets for: ${missingPlatforms.join(', ')}`,
      );
    }
    const integrationIds = [
      ...new Set(targets.map((target) => target.postizIntegrationId)),
    ];
    if (integrationIds.length) {
      for (const integrationId of integrationIds) {
        await this.access.assertIntegrationPermission(user, integrationId, 'canPublish');
      }
    } else {
      await this.access.assertPermission(user, item.language, 'canPublish');
    }
    const approved = await this.prisma.contentItem.updateMany({
      where: { id, status: 'REVIEW' },
      data: {
        status: 'APPROVED',
        forceReview: false,
        publishTargets: targets,
      },
    });
    if (!approved.count) throw new BadRequestException('content is no longer awaiting review');
    try {
      const preparationQueued = await this.publish.dispatch(id, targets);
      return { preparationQueued };
    } catch (error) {
      await this.prisma.contentItem.updateMany({
        where: { id, status: { in: ['APPROVED', 'PUBLISHING'] } },
        data: { status: 'REVIEW', lastError: (error as Error).message }
      });
      throw error;
    }
  }

  @Post(':id/reject')
  async reject(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== 'REVIEW') throw new BadRequestException(`cannot reject status=${item.status}`);
    await this.access.assertPermission(user, item.language, 'canReview');
    const rejected = await this.prisma.contentItem.updateMany({
      where: { id, status: 'REVIEW' },
      data: { status: 'REJECTED' },
    });
    if (!rejected.count) throw new BadRequestException('content is no longer awaiting review');
    return { rejected: true };
  }

  // 非 admin 的可见性：
  // - 语言集合覆盖的常规内容（Notion / HTTP / WikiFX）
  // - 自己账号关联的手动撰写内容（其语言可能不在语言集合内）
  // 返回值 null 表示当前用户没有任何可见内容，{} 表示不受限（admin）
  private async buildVisibilityWhere(
    user: RequestUser,
  ): Promise<Record<string, unknown> | null> {
    const [languages, accountIds] = await Promise.all([
      this.access.visibleLanguages(user),
      this.access.visibleAccountIds(user),
    ]);
    if (languages === null || accountIds === null) return {};
    const clauses: Array<Record<string, unknown>> = [];
    if (languages.length) clauses.push({ language: { in: languages } });
    if (accountIds.length) {
      clauses.push({
        source: 'manual',
        targetAccountIds: { hasSome: accountIds },
      });
    }
    return clauses.length ? { OR: clauses } : null;
  }

  // 单条内容的可见性判定，与 buildVisibilityWhere 保持同一语义
  private async isVisibleTo(
    user: RequestUser,
    item: { language: string; source: string; targetAccountIds: string[] },
  ): Promise<boolean> {
    const [languages, accountIds] = await Promise.all([
      this.access.visibleLanguages(user),
      this.access.visibleAccountIds(user),
    ]);
    if (languages === null || accountIds === null) return true;
    if (languages.includes(item.language)) return true;
    return (
      item.source === 'manual' &&
      item.targetAccountIds.some((accountId) => accountIds.includes(accountId))
    );
  }
}
