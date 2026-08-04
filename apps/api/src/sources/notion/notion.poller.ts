import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';
import { NotionService } from './notion.service';

// 入口 1：Notion 轮询。source_databases 配置驱动；重复拾取由 content_items 幂等键兜底
@Injectable()
export class NotionPoller {
  private readonly logger = new Logger(NotionPoller.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notion: NotionService,
    private readonly ingest: IngestService,
  ) {}

  @Cron('*/5 * * * *')
  async poll() {
    if (this.running || !process.env.NOTION_TOKEN) return;
    this.running = true;
    const report: Record<string, number | string> = {};
    try {
      const sources = await this.prisma.sourceDatabase.findMany({ where: { enabled: true } });
      for (const src of sources) {
        try {
          report[`${src.language}/${src.tableType}`] = await this.pollOne(src);
        } catch (e) {
          report[`${src.language}/${src.tableType}`] = `error: ${(e as Error).message}`;
          this.logger.error(`poll ${src.notionDatabaseId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    return report;
  }

  private async pollOne(src: {
    id: string;
    notionDatabaseId: string;
    language: string;
    tableType: string;
    lastPolledAt: Date | null;
  }): Promise<number> {
    const startedAt = new Date();
    const pages = await this.notion.queryReadyPages(src.notionDatabaseId, src.lastPolledAt ?? undefined);
    let ingested = 0;
    for (const page of pages) {
      const payload = await this.notion.toPayload(page, src.notionDatabaseId, src.language, src.tableType);
      if (!payload) {
        this.logger.warn(`skip page ${page.id}: 标题缺失`);
        continue;
      }
      await this.ingest.upsert('notion', payload);
      ingested++;
    }
    await this.prisma.sourceDatabase.update({ where: { id: src.id }, data: { lastPolledAt: startedAt } });
    return ingested;
  }
}
