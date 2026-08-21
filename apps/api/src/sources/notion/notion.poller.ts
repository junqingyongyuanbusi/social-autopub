import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';
import { sourceMediaIdentity } from '../../ingest/media-identity';
import { NotionService } from './notion.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { withTimeout } from '../../common/with-timeout';
import { exposureReviewLinkProblem } from '../../generation/social-post'

// 入口 1：Notion 轮询。source_databases 配置驱动；重复拾取由 content_items 幂等键兜底。
// 多副本安全：Redis 分布式锁保证同一时刻只有一个 api 实例在轮询，避免重复打 Notion 配额。
@Injectable()
export class NotionPoller {
  private readonly logger = new Logger(NotionPoller.name);
  private running = false;
  private lockLost = false;
  private activeLockToken: string | null = null
  private static readonly LOCK_KEY = 'lock:notion_poll';
  private static readonly LOCK_TTL_S = 600; // 覆盖最慢单轮（20 库 × 分页/块抓取）

  constructor(
    private readonly prisma: PrismaService,
    private readonly notion: NotionService,
    private readonly ingest: IngestService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async poll() {
    if (this.running || !process.env.NOTION_TOKEN) return;
    const lockToken = randomUUID();
    // 抢锁失败说明另一副本正在轮询，本实例跳过
    const locked = await withTimeout(
      this.redis.set(
        NotionPoller.LOCK_KEY,
        lockToken,
        'EX',
        NotionPoller.LOCK_TTL_S,
        'NX',
      ),
      3_000,
    ).catch(() => null);
    if (!locked) return;
    this.running = true;
    this.lockLost = false;
    this.activeLockToken = lockToken
    const heartbeat = setInterval(() => {
      void this.extendLock(lockToken).then((extended) => {
        if (!extended && this.activeLockToken === lockToken) this.lockLost = true;
      });
    }, (NotionPoller.LOCK_TTL_S * 1000) / 3)
    const report: Record<string, number | string> = {};
    try {
      const sources = await this.prisma.sourceDatabase.findMany({ where: { enabled: true } });
      for (const src of sources) {
        if (this.lockLost) throw new Error('Notion 轮询锁已丢失，停止本轮处理')
        try {
          report[`${src.language}/${src.tableType}`] = await this.pollOne(src, lockToken)
        } catch (e) {
          report[`${src.language}/${src.tableType}`] = `error: ${(e as Error).message}`;
          this.logger.error(`poll ${src.notionDatabaseId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (this.activeLockToken === lockToken) this.activeLockToken = null
      this.running = false;
      await this.releaseLock(lockToken)
    }
    return report;
  }

  private async extendLock(token: string) {
    const result = await this.redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        NotionPoller.LOCK_KEY,
        token,
        NotionPoller.LOCK_TTL_S,
      )
      .catch(() => 0);
    return Number(result) === 1;
  }

  private async assertLockOwned(token: string, message: string) {
    if (
      this.activeLockToken !== token ||
      this.lockLost ||
      !(await this.extendLock(token))
    ) {
      this.lockLost = true;
      throw new Error(message);
    }
  }

  private async releaseLock(token: string) {
    await this.redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        NotionPoller.LOCK_KEY,
        token,
      )
      .catch(() => {});
  }

  async backfillExposureReviewLinks() {
    if (this.running) throw new Error('Notion 轮询正在运行，请稍后重试');
    if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 未配置');

    const lockToken = randomUUID();
    const locked = await withTimeout(
      this.redis.set(
        NotionPoller.LOCK_KEY,
        lockToken,
        'EX',
        NotionPoller.LOCK_TTL_S,
        'NX',
      ),
      3_000,
    ).catch(() => null);
    if (!locked) throw new Error('另一个 Notion 任务正在运行，请稍后重试');

    this.running = true;
    this.lockLost = false;
    this.activeLockToken = lockToken
    const heartbeat = setInterval(() => {
      void this.extendLock(lockToken).then((extended) => {
        if (!extended && this.activeLockToken === lockToken) this.lockLost = true;
      });
    }, (NotionPoller.LOCK_TTL_S * 1000) / 3)
    const report = {
      sources: 0,
      scanned: 0,
      matched: 0,
      requeued: 0,
      invalid: 0,
      skipped: 0,
      noMatchingItem: 0,
      protectedStatus: 0,
      withPublishJobs: 0,
      activeGenerating: 0,
      payloadErrors: 0,
      raceSkipped: 0,
      requeueSkipped: 0,
      unchanged: 0,
      pendingRequeued: 0,
    };

    try {
      const sources = await this.prisma.sourceDatabase.findMany({
        where: { tableType: 'exposure-review', enabled: true },
      });
      report.sources = sources.length;
      for (const source of sources) {
        if (this.lockLost) throw new Error('Notion backfill 锁已丢失，停止处理')
        const pages = await this.notion.queryAllReadyPages(source.notionDatabaseId);
        await this.assertLockOwned(lockToken, 'Notion backfill 锁已丢失，停止处理')
        report.scanned += pages.length;
        for (const page of pages) {
          if (this.lockLost) throw new Error('Notion backfill 锁已丢失，停止处理')
          const parsed = await this.notion.toPayload(
            page,
            source.notionDatabaseId,
            source.language,
            source.tableType,
          );
          if (!parsed) {
            report.skipped++;
            report.payloadErrors++;
            continue;
          }
          const { payload } = parsed;
          const existing = await this.ingest.findPreferredNotionEquivalent(
            page.id,
            payload.title,
            payload.body,
            parsed.mediaRefs,
          );
          if (!existing) {
            report.skipped++;
            report.noMatchingItem++;
            continue;
          }
          if (
            !['PENDING', 'REVIEW', 'FAILED'].includes(existing.status) ||
            existing.jobs.length > 0
          ) {
            report.skipped++;
            if (existing.status === 'GENERATING') report.activeGenerating++;
            else if (existing.jobs.length > 0) report.withPublishJobs++;
            else report.protectedStatus++;
            continue;
          }
          report.matched++;
          const linkProblem = exposureReviewLinkProblem({
            source: 'notion',
            sourceTableType: source.tableType,
            publishLink: payload.publish_link ?? null,
            language: source.language,
            contentType: payload.content_type,
          });
          const metadata = {
            language: source.language,
            contentType: payload.content_type,
            sourceTableType: source.tableType,
            publishLink: payload.publish_link ?? null,
            media: payload.media,
            mediaFingerprint: sourceMediaIdentity(parsed.mediaRefs),
            rawPayload: JSON.parse(JSON.stringify(parsed.rawPayload)),
          };
          const metadataChanged =
            existing.language !== source.language ||
            existing.contentType !== payload.content_type ||
            existing.sourceTableType !== source.tableType ||
            existing.publishLink !== (payload.publish_link ?? null) ||
            existing.mediaFingerprint !== sourceMediaIdentity(parsed.mediaRefs);
          const existingLinkFailure = existing.lastError?.startsWith(
            '发布链接 / Publish link',
          );
          if (!metadataChanged && !linkProblem && !existingLinkFailure) {
            if (existing.status === 'PENDING' && existing.forceReview) {
              await this.assertLockOwned(lockToken, 'Notion backfill 锁已丢失，停止处理');
              if (await this.ingest.ensurePendingGenerationJob(existing.id, true)) {
                report.requeued++;
                report.pendingRequeued++;
              } else {
                report.skipped++;
                report.requeueSkipped++;
              }
            } else if (existing.status === 'FAILED' && existing.forceReview) {
              await this.assertLockOwned(lockToken, 'Notion backfill 锁已丢失，停止处理');
              if (
                await this.ingest.requeueForMetadataRefresh(
                  existing.id,
                  metadata,
                  true,
                )
              ) {
                report.requeued++;
              } else {
                report.skipped++;
                report.requeueSkipped++;
              }
            } else {
              report.skipped++;
              report.unchanged++;
            }
            continue;
          }
          if (!metadataChanged && existing.lastError === linkProblem) {
            report.invalid++;
            continue;
          }
          await this.assertLockOwned(lockToken, 'Notion backfill 锁已丢失，停止处理')
          if (linkProblem) {
            const updated = await this.ingest.failForInvalidMetadata(
              existing.id,
              metadata,
              linkProblem,
            )
            if (!updated) {
              report.skipped++;
              report.raceSkipped++;
              continue;
            }
            report.invalid++;
            continue;
          }
          if (
            await this.ingest.requeueForMetadataRefresh(
              existing.id,
              metadata,
              true,
            )
          ) {
            report.requeued++;
          } else {
            report.skipped++;
            report.requeueSkipped++;
          }
        }
      }
      return report;
    } finally {
      clearInterval(heartbeat);
      if (this.activeLockToken === lockToken) this.activeLockToken = null
      this.running = false;
      await this.releaseLock(lockToken);
    }
  }
  private async pollOne(src: {
    id: string;
    notionDatabaseId: string;
    language: string;
    tableType: string;
    lastPolledAt: Date | null;
  }, lockToken: string): Promise<number> {
    const startedAt = new Date();
    const freshPages = await this.notion.queryReadyPages(
      src.notionDatabaseId,
      src.lastPolledAt ?? undefined,
    );
    await this.assertLockOwned(lockToken, 'Notion 轮询锁已丢失，停止本轮处理');
    const failures = await this.prisma.notionIngestFailure.findMany({
      where: { sourceDatabaseId: src.id },
      select: { pageId: true, attempts: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    const dueFailures = failures
      .filter((failure) => {
        const retryDelayMs = Math.min(
          5 * 60_000 * 2 ** Math.min(failure.attempts - 1, 6),
          6 * 60 * 60_000,
        );
        return Date.now() - failure.updatedAt.getTime() >= retryDelayMs;
      })
      .slice(0, 3);
    const retryPages: Array<{ id: string; properties: Record<string, any> }> = [];
    for (const failure of dueFailures) {
      try {
        const page = await this.notion.retrievePage(failure.pageId);
        if (!(await this.notion.isReadyPage(page, src.notionDatabaseId))) {
          await this.prisma.notionIngestFailure.deleteMany({
            where: { sourceDatabaseId: src.id, pageId: failure.pageId },
          });
          continue;
        }
        retryPages.push(page);
      } catch (error) {
        await this.prisma.notionIngestFailure.updateMany({
          where: { sourceDatabaseId: src.id, pageId: failure.pageId },
          data: {
            error: (error as Error).message,
            attempts: { increment: 1 },
          },
        });
      }
    }
    const pages = [
      ...new Map(
        [...freshPages, ...retryPages].map((page) => [page.id, page]),
      ).values(),
    ];
    let ingested = 0;
    for (const page of pages) {
      if (this.lockLost) throw new Error('Notion 轮询锁已丢失，停止本轮处理');
      try {
        const parsed = await this.notion.toPayload(
          page,
          src.notionDatabaseId,
          src.language,
          src.tableType,
        );
        if (!parsed) {
          this.logger.warn(`skip page ${page.id}: 标题缺失`);
          await this.prisma.notionIngestFailure.deleteMany({
            where: { sourceDatabaseId: src.id, pageId: page.id },
          });
          continue;
        }
        await this.assertLockOwned(lockToken, 'Notion 轮询锁已丢失，停止本轮处理');
        await this.ingest.upsert('notion', parsed.payload, {
          rawPayload: parsed.rawPayload,
          sourceMedia: parsed.mediaRefs,
        });
        await this.prisma.notionIngestFailure.deleteMany({
          where: { sourceDatabaseId: src.id, pageId: page.id },
        });
        ingested++;
      } catch (error) {
        if (this.lockLost) throw error;
        await this.prisma.notionIngestFailure.upsert({
          where: {
            sourceDatabaseId_pageId: {
              sourceDatabaseId: src.id,
              pageId: page.id,
            },
          },
          create: {
            sourceDatabaseId: src.id,
            pageId: page.id,
            error: (error as Error).message,
          },
          update: {
            error: (error as Error).message,
            attempts: { increment: 1 },
          },
        });
        this.logger.error(
          `Notion page ${page.id} ingest failed and was queued for isolated retry: ${(error as Error).message}`,
        );
      }
    }
    await this.assertLockOwned(lockToken, 'Notion 轮询锁已丢失，不推进轮询水位')
    await this.prisma.sourceDatabase.update({ where: { id: src.id }, data: { lastPolledAt: startedAt } })
    return ingested;
  }
}
