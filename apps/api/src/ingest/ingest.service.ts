import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_GENERATION, GenerationJobData } from '../queues';
import { IngestPayload } from './ingest.schema';

// 统一入库口：Notion 轮询与 HTTP ingest 都经此进入同一状态机
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_GENERATION) private readonly generationQueue: Queue<GenerationJobData>,
  ) {}

  async upsert(source: string, payload: IngestPayload) {
    const contentHash = createHash('sha256')
      .update(payload.title + payload.body + payload.media.join(','))
      .digest('hex')
      .slice(0, 16);

    // 幂等：同源同 id 同内容 → 返回已有任务，不重复生成
    const existing = await this.prisma.contentItem.findUnique({
      where: {
        source_externalId_contentHash: { source, externalId: payload.external_id, contentHash },
      },
    });
    if (existing) return existing;

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
    if (superseded.count) this.logger.log(`superseded ${superseded.count} stale item(s) of ${source}:${payload.external_id}`);

    const item = await this.prisma.contentItem.create({
      data: {
        source,
        externalId: payload.external_id,
        contentHash,
        language: payload.language,
        contentType: payload.content_type,
        title: payload.title,
        body: payload.body,
        media: payload.media,
        targetPlatforms: payload.target_platforms,
        publishAt: payload.publish_at ? new Date(payload.publish_at) : null,
        rawPayload: JSON.parse(JSON.stringify(payload)),
      },
    });

    await this.generationQueue.add(
      'generate',
      { contentItemId: item.id },
      { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
    );
    this.logger.log(`ingested ${source}:${payload.external_id} -> ${item.id}`);
    return item;
  }

  findById(id: string) {
    return this.prisma.contentItem.findUnique({ where: { id }, include: { jobs: true } });
  }
}
