import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PublishService } from '../publish/publish.service';
import { QUEUE_GENERATION, QUEUE_PUBLISH, GenerationJobData, PublishJobData } from '../queues';

// 控制台 BFF：内容队列 / 审核工作台 / 发布记录
@Controller('contents')
@UseGuards(AdminKeyGuard)
export class ContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PublishService,
    @InjectQueue(QUEUE_GENERATION) private readonly generationQueue: Queue<GenerationJobData>,
    @InjectQueue(QUEUE_PUBLISH) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  // 清空积压：默认删除未发布任务、保留发布历史；?all=true 连历史一并全清。
  // 同时排空两个队列并重置轮询游标
  @Post('purge')
  async purge(@Query('all') all?: string) {
    await this.generationQueue.drain(true);
    await this.publishQueue.drain(true);
    const deleted = await this.prisma.contentItem.deleteMany({
      where: all === 'true' ? {} : { status: { notIn: ['PUBLISHED', 'PUBLISHING'] } },
    });
    await this.prisma.sourceDatabase.updateMany({ data: { lastPolledAt: null } });
    return { deleted: deleted.count };
  }

  // 批量把生成失败的内容重回生成队列（常见于路由矩阵补配之后）
  @Post('requeue-failed')
  async requeueFailed() {
    const failed = await this.prisma.contentItem.findMany({
      where: { status: 'FAILED', jobs: { none: {} } }, // 只重试从未进入发布环节的
      select: { id: true },
    });
    for (const { id } of failed) {
      await this.prisma.contentItem.update({ where: { id }, data: { status: 'PENDING' } });
      await this.generationQueue.add(
        'generate',
        { contentItemId: id },
        { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
      );
    }
    return { requeued: failed.length };
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('language') language?: string,
    @Query('contentType') contentType?: string,
  ) {
    return this.prisma.contentItem.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(language ? { language } : {}),
        ...(contentType ? { contentType } : {}),
      },
      include: { generations: true, jobs: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const item = await this.prisma.contentItem.findUnique({
      where: { id },
      include: { generations: true, jobs: true },
    });
    if (!item) throw new NotFoundException();
    return item;
  }

  // 审核工作台行内编辑某平台文案
  @Patch(':id/generations/:platform')
  async editGeneration(
    @Param('id') id: string,
    @Param('platform') platform: string,
    @Body() body: { content?: string; media?: string[] },
  ) {
    if (!body.content?.trim()) throw new BadRequestException('content required');
    return this.prisma.generation.update({
      where: { contentItemId_platform: { contentItemId: id, platform } },
      data: { content: body.content, ...(body.media ? { media: body.media } : {}) },
    });
  }

  // 单条重新生成（FAILED/REJECTED/REVIEW 状态可用；REVIEW 下会覆盖已有草稿）
  @Post(':id/regenerate')
  async regenerate(@Param('id') id: string) {
    const item = await this.prisma.contentItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    if (!['FAILED', 'REJECTED', 'REVIEW'].includes(item.status)) {
      throw new BadRequestException(`cannot regenerate status=${item.status}`);
    }
    await this.prisma.contentItem.update({ where: { id }, data: { status: 'PENDING' } });
    await this.generationQueue.add(
      'generate',
      { contentItemId: id },
      { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
    );
    return { ok: true };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    const item = await this.prisma.contentItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== 'REVIEW') throw new BadRequestException(`cannot approve status=${item.status}`);
    await this.prisma.contentItem.update({ where: { id }, data: { status: 'APPROVED' } });
    const dispatched = await this.publish.dispatch(id);
    return { dispatched };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    return this.prisma.contentItem.update({ where: { id }, data: { status: 'REJECTED' } });
  }
}
