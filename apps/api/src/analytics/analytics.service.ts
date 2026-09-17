import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { RequestUser } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

export interface MetricPoint {
  date: string; // YYYY-MM-DD（快照值口径：当日 Postiz 汇报的累计值）
  value: number;
}

export interface MetricSummary {
  metric: string;
  latestValue: number;
  latestDate: string;
  changePct: number | null; // 窗口首日 → 最新值的变化率；无基线时为 null
}

export interface AnalyticsOverview {
  days: number;
  metrics: MetricSummary[]; // 可见账号合计口径
  series: Array<{ metric: string; points: MetricPoint[] }>; // 可见账号按日合计，用于趋势图
  accounts: Array<{
    accountId: string;
    name: string;
    platform: string;
    market: string | null;
    metrics: MetricSummary[];
  }>;
}

export interface AccountSeries {
  account: { id: string; name: string; platform: string; market: string | null };
  series: Array<{ metric: string; points: MetricPoint[] }>;
}

export interface AnalyticsPostRow {
  publishJobId: string;
  platform: string;
  title: string;
  language: string;
  publishedAt: string;
  metrics: Array<{ metric: string; total: number }>;
}

interface SnapshotRow {
  metric: string;
  date: Date;
  value: number;
}

interface AccountMetricGroup {
  accountName: string;
  accountPlatform: string;
  accountMarket: string | null;
  rows: SnapshotRow[];
}

// 分析查询服务：全部读本地快照表，按账号可见性（admin 全量 / operator 被分配账号）过滤
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async overview(user: RequestUser, days: number): Promise<AnalyticsOverview> {
    const accountIds = await this.access.visibleAccountIds(user);
    if (accountIds !== null && accountIds.length === 0) {
      return { days, metrics: [], series: [], accounts: [] };
    }
    const snapshots = await this.prisma.accountMetricSnapshot.findMany({
      where: {
        date: { gte: windowStart(days) },
        ...(accountIds !== null ? { accountId: { in: accountIds } } : {}),
      },
      include: { account: { select: { name: true, platform: true, market: true } } },
      orderBy: [{ metric: 'asc' }, { date: 'asc' }],
    });

    // 分组：账号 → 指标 → 按日升序序列
    const groups = groupByAccountAndMetric(snapshots);
    const accounts = [...groups.entries()].flatMap(([accountId, perMetric]) => {
      const first = perMetric.values().next().value;
      if (!first) return [];
      return {
        accountId,
        name: first.accountName,
        platform: first.accountPlatform,
        market: first.accountMarket,
        metrics: [...perMetric.values()].map((group) => summarize(group.rows)),
      };
    });

    // 合计口径：指标最新值跨账号求和；趋势线为同指标按日跨账号求和
    const metricNames = [...new Set(snapshots.map((row) => row.metric))].sort();
    const metricGroups = metricNames.map((metric) => ({
      metric,
      rowsList: [...groups.values()]
        .map((perMetric) => perMetric.get(metric))
        .filter((group): group is AccountMetricGroup => Boolean(group))
        .map((group) => group.rows),
    }));
    const metrics = metricGroups.map(({ metric, rowsList }) => {
      const merged = mergeMetricSeries(rowsList);
      const summary = summarize(merged);
      const latestSum = rowsList.reduce(
        (sum, rows) => sum + rows[rows.length - 1].value,
        0,
      );
      return {
        metric,
        latestValue: latestSum,
        latestDate: summary.latestDate,
        changePct: summary.changePct,
      };
    });
    const series = metricGroups.map(({ metric, rowsList }) => ({
      metric,
      points: toPoints(mergeMetricSeries(rowsList)),
    }));

    return { days, metrics, series, accounts };
  }

  async accountSeries(
    user: RequestUser,
    accountId: string,
    days: number,
  ): Promise<AccountSeries> {
    const visibleIds = await this.access.visibleAccountIds(user);
    if (visibleIds !== null && !visibleIds.includes(accountId)) {
      throw new ForbiddenException('无权查看该账号的分析数据');
    }
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, platform: true, market: true },
    });
    if (!account) throw new NotFoundException();
    const snapshots = await this.prisma.accountMetricSnapshot.findMany({
      where: { accountId, date: { gte: windowStart(days) } },
      orderBy: [{ metric: 'asc' }, { date: 'asc' }],
    });
    const series = groupByMetric(snapshots).map(([metric, rows]) => ({
      metric,
      points: toPoints(rows),
    }));
    return { account, series };
  }

  async posts(user: RequestUser, days: number): Promise<AnalyticsPostRow[]> {
    const integrationIds = await this.access.visibleIntegrationIds(user);
    if (integrationIds !== null && integrationIds.length === 0) return [];
    const jobs = await this.prisma.publishJob.findMany({
      where: {
        status: 'sent',
        postizPostId: { not: null },
        ...(integrationIds !== null
          ? { postizIntegrationId: { in: integrationIds } }
          : {}),
      },
      include: { contentItem: { select: { title: true, language: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    if (!jobs.length) return [];
    const snapshots = await this.prisma.postMetricSnapshot.findMany({
      where: {
        publishJobId: { in: jobs.map((job) => job.id) },
        date: { gte: windowStart(days) },
      },
      orderBy: [{ publishJobId: 'asc' }, { metric: 'asc' }, { date: 'asc' }],
    });

    // 帖子指标取窗口内最新快照值（Postiz 为累计口径，不按日求和）
    const latestByJobMetric = new Map<string, number>();
    for (const row of snapshots) {
      latestByJobMetric.set(`${row.publishJobId}\u0000${row.metric}`, row.value);
    }
    return jobs.map((job) => {
      const jobMetrics = [...new Set(
        snapshots
          .filter((row) => row.publishJobId === job.id)
          .map((row) => row.metric),
      )].sort();
      return {
        publishJobId: job.id,
        platform: job.platform,
        title: job.contentItem.title,
        language: job.contentItem.language,
        publishedAt: (job.scheduledAt ?? job.updatedAt).toISOString(),
        metrics: jobMetrics.map((metric) => ({
          metric,
          total: latestByJobMetric.get(`${job.id}\u0000${metric}`) ?? 0,
        })),
      };
    });
  }
}

function summarize(rows: SnapshotRow[]): MetricSummary {
  const latest = rows[rows.length - 1];
  const first = rows[0];
  return {
    metric: latest.metric,
    latestValue: latest.value,
    latestDate: toDateKey(latest.date),
    changePct:
      first.value !== 0
        ? Number((((latest.value - first.value) / first.value) * 100).toFixed(1))
        : null,
  };
}

function windowStart(days: number): Date {
  return new Date(utcDayKey(Date.now() - (days - 1) * DAY_MS));
}

function utcDayKey(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toDateKey(date: Date): string {
  return new Date(utcDayKey(date.getTime())).toISOString().slice(0, 10);
}

function toPoints(rows: SnapshotRow[]): MetricPoint[] {
  return rows.map((row) => ({ date: toDateKey(row.date), value: row.value }));
}

function groupByAccountAndMetric(
  rows: Array<SnapshotRow & { accountId: string; account: { name: string; platform: string; market: string | null } }>,
): Map<string, Map<string, AccountMetricGroup>> {
  const byAccount = new Map<string, Map<string, AccountMetricGroup>>();
  for (const row of rows) {
    let perMetric = byAccount.get(row.accountId);
    if (!perMetric) {
      perMetric = new Map();
      byAccount.set(row.accountId, perMetric);
    }
    let group = perMetric.get(row.metric);
    if (!group) {
      group = {
        accountName: row.account.name,
        accountPlatform: row.account.platform,
        accountMarket: row.account.market,
        rows: [],
      };
      perMetric.set(row.metric, group);
    }
    group.rows.push({ metric: row.metric, date: row.date, value: row.value });
  }
  return byAccount;
}

function groupByMetric(rows: SnapshotRow[]): Array<[string, SnapshotRow[]]> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.metric);
    if (existing) existing.push(row);
    else groups.set(row.metric, [row]);
  }
  return [...groups.entries()];
}

function mergeMetricSeries(rowsList: SnapshotRow[][]): SnapshotRow[] {
  // 同指标多账号序列按日合并求和（缺失日期按当日可用账号求和）
  const sumByDate = new Map<number, { total: number; metric: string }>();
  for (const rows of rowsList) {
    for (const row of rows) {
      const key = utcDayKey(row.date.getTime());
      const existing = sumByDate.get(key);
      if (existing) existing.total += row.value;
      else sumByDate.set(key, { total: row.value, metric: row.metric });
    }
  }
  return [...sumByDate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, { total, metric }]) => ({
      metric,
      date: new Date(key),
      value: total,
    }));
}
