"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  AnalyticsMetricSummary,
  AnalyticsOverview,
  AnalyticsPostRow,
  fetchAnalyticsOverview,
  fetchAnalyticsPosts,
  syncAnalytics,
} from "@/lib/api";
import { TrendChart } from "@/components/trend-chart";

const WINDOWS = [7, 30, 90] as const;

// 常见 Postiz 指标的中文名；未收录的指标原样展示
const METRIC_LABELS: Record<string, string> = {
  Followers: "粉丝数",
  Impressions: "曝光量",
  Engagement: "互动量",
  Likes: "点赞",
  Comments: "评论",
  Shares: "分享",
  Retweets: "转推",
  Replies: "回复",
  Bookmarks: "收藏",
  Quotes: "引用",
  ProfileVisits: "主页访问",
  VideoViews: "视频观看",
  Clicks: "链接点击",
};

const metricLabel = (metric: string) => METRIC_LABELS[metric] ?? metric;

function formatLastSynced(iso: string | null | undefined): string {
  if (!iso) return "暂无同步记录";
  try {
    const date = new Date(iso);
    const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function ChangeBadge({ changePct }: { changePct: number | null }) {
  if (changePct === null) {
    return <span className="text-xs text-muted-foreground">无基线</span>;
  }
  const positive = changePct >= 0;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        positive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {positive ? "+" : ""}
      {changePct.toFixed(1)}%
    </span>
  );
}

function MetricCard({ summary }: { summary: AnalyticsMetricSummary }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{metricLabel(summary.metric)}</span>
        <ChangeBadge changePct={summary.changePct} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {summary.latestValue.toLocaleString("zh-CN")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        截至 {summary.latestDate}
      </p>
    </div>
  );
}

// 数据分析看板：全部读本地快照表（每 30 分钟自动采集），权限与账号健康页一致
export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [posts, setPosts] = useState<AnalyticsPostRow[]>([]);
  const [activeMetric, setActiveMetric] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback((windowDays: number) => {
    setLoading(true);
    setError("");
    Promise.all([fetchAnalyticsOverview(windowDays), fetchAnalyticsPosts(windowDays)])
      .then(([overviewData, postsData]) => {
        setOverview(overviewData);
        setPosts(postsData);
        setActiveMetric((current) =>
          overviewData.series.some((entry) => entry.metric === current)
            ? current
            : overviewData.series[0]?.metric ?? "",
        );
      })
      .catch(() => setError("加载分析数据失败，请稍后重试"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(days), [days, load]);

  // 触发后台同步：带冷却防抖保护（force=true 跳过冷却）
  const triggerSync = useCallback(
    async (force = false) => {
      setSyncing(true);
      setSyncNotice("");
      try {
        const res = await syncAnalytics(force);
        if (res.synced) {
          setSyncNotice("已获取最新数据");
          // 静默更新看板
          const [overviewData, postsData] = await Promise.all([
            fetchAnalyticsOverview(days),
            fetchAnalyticsPosts(days),
          ]);
          setOverview(overviewData);
          setPosts(postsData);
        } else if (res.reason === "cooldown" && force) {
          setSyncNotice("数据已是最新（3分钟内已刷新）");
        }
      } catch {
        if (force) setSyncNotice("刷新失败，请稍后重试");
      } finally {
        setSyncing(false);
        setTimeout(() => setSyncNotice(""), 3000);
      }
    },
    [days],
  );

  // 进入页面时：自动后台静默触发一次同步（受 3 分钟冷却保护，不阻塞页面秒开）
  const initialSyncRef = useRef(false);
  useEffect(() => {
    if (!initialSyncRef.current) {
      initialSyncRef.current = true;
      void triggerSync(false);
    }
  }, [triggerSync]);

  const activeSeries = overview?.series.find((entry) => entry.metric === activeMetric);
  const hasData = Boolean(overview && (overview.metrics.length || overview.accounts.length));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">数据分析</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            进入页面自动刷新最新统计，后台亦每 30 分钟例行采集；仅展示你有权限的账号
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {overview?.lastSyncedAt && (
            <span className="text-xs text-muted-foreground tabular-nums">
              更新于 {formatLastSynced(overview.lastSyncedAt)}
            </span>
          )}
          {syncNotice && (
            <span className="text-xs text-primary transition-opacity">
              {syncNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => void triggerSync(true)}
            disabled={syncing}
            title="强制从 Postiz 拉取最新统计数据"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-all hover:border-primary hover:text-primary active:scale-95 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${syncing ? "animate-spin text-primary" : ""}`}
              aria-hidden
            />
            {syncing ? "正在更新…" : "立即刷新"}
          </button>
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="min-h-9 rounded-md border border-border bg-card px-2.5 py-1 text-sm"
            aria-label="统计窗口"
          >
            {WINDOWS.map((value) => (
              <option key={value} value={value}>近 {value} 天</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && !hasData && !error && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无分析数据。发布成功后需等待下一轮自动采集（每 30 分钟），账号刚绑定也会在半小时内首次出数。
        </div>
      )}

      {!loading && overview && overview.metrics.length > 0 && (
        <section className="mb-6" aria-label="核心指标">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overview.metrics.map((summary) => (
              <MetricCard key={summary.metric} summary={summary} />
            ))}
          </div>
        </section>
      )}

      {!loading && overview && overview.series.length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-card p-4" aria-label="趋势图">
          <div className="mb-3 flex flex-wrap gap-2">
            {overview.series.map((entry) => (
              <button
                key={entry.metric}
                type="button"
                onClick={() => setActiveMetric(entry.metric)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeMetric === entry.metric
                    ? "bg-primary font-medium text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {metricLabel(entry.metric)}
              </button>
            ))}
          </div>
          {activeSeries && <TrendChart points={activeSeries.points} />}
        </section>
      )}

      {!loading && overview && overview.accounts.length > 0 && (
        <section className="mb-6" aria-label="账号明细">
          <h2 className="mb-3 text-base font-semibold">账号明细</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.accounts.map((account) => (
              <div key={account.accountId} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase text-muted-foreground">
                    {account.platform}
                  </span>
                </div>
                {account.market && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    市场：{account.market.toUpperCase()}
                  </p>
                )}
                <dl className="mt-3 space-y-1.5">
                  {account.metrics.map((summary) => (
                    <div key={summary.metric} className="flex items-center justify-between text-sm">
                      <dt className="text-muted-foreground">{metricLabel(summary.metric)}</dt>
                      <dd className="flex items-center gap-2 tabular-nums">
                        {summary.latestValue.toLocaleString("zh-CN")}
                        <ChangeBadge changePct={summary.changePct} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && posts.length > 0 && (
        <section aria-label="帖子表现">
          <h2 className="mb-3 text-base font-semibold">帖子表现</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium">平台</th>
                  <th className="px-4 py-2.5 font-medium">发布时间</th>
                  <th className="px-4 py-2.5 font-medium">指标</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.publishJobId} className="border-b border-border/60 last:border-b-0">
                    <td className="max-w-64 truncate px-4 py-2.5" title={post.title}>
                      {post.title}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase text-muted-foreground">
                        {post.platform}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                      {new Date(post.publishedAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                        {post.metrics.map((metric) => (
                          <span key={metric.metric} className="text-muted-foreground">
                            {metricLabel(metric.metric)}
                            <span className="ml-1 font-medium text-foreground">
                              {metric.total.toLocaleString("zh-CN")}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
