import Link from 'next/link';
import { fetchStats } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CARD_ORDER = [
  { status: 'REVIEW', label: '待审核', className: 'text-warning' },
  { status: 'GENERATING', label: '生成中', className: 'text-info' },
  { status: 'PUBLISHING', label: '发布中', className: 'text-info' },
  { status: 'PUBLISHED', label: '已发布', className: 'text-success' },
  { status: 'FAILED', label: '失败', className: 'text-destructive' },
];
const PLATFORM_LABEL: Record<string, string> = { x: 'X', instagram: 'Instagram', facebook: 'Facebook' };

// 总览：状态计数 + 近 7 日平台发布量 + 最近失败
export default async function DashboardPage() {
  const stats = await fetchStats().catch(() => null);
  if (!stats) {
    return (
      <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        统计数据加载失败，请确认 API 服务状态后刷新。
      </div>
    );
  }

  const count = (status: string) => stats.byStatus.find((s) => s.status === status)?._count ?? 0;
  const platforms = [...new Set(stats.jobsByPlatform.map((j) => j.platform))];
  const platformCount = (platform: string, status: string) =>
    stats.jobsByPlatform.find((j) => j.platform === platform && j.status === status)?._count ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">总览</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {CARD_ORDER.map((c) => (
          <Link
            key={c.status}
            href={`/queue?status=${c.status}`}
            className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
          >
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${c.className}`}>{count(c.status)}</p>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">近 7 日各平台发布</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">平台</th>
                <th className="px-4 py-2.5 font-medium tabular-nums">已提交</th>
                <th className="px-4 py-2.5 font-medium tabular-nums">失败</th>
                <th className="px-4 py-2.5 font-medium tabular-nums">队列中</th>
              </tr>
            </thead>
            <tbody>
              {platforms.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    近 7 日暂无发布
                  </td>
                </tr>
              ) : (
                platforms.map((p) => (
                  <tr key={p} className="border-t border-border">
                    <td className="px-4 py-2.5">{PLATFORM_LABEL[p] ?? p}</td>
                    <td className="px-4 py-2.5 tabular-nums text-success">{platformCount(p, 'sent')}</td>
                    <td className="px-4 py-2.5 tabular-nums text-destructive">{platformCount(p, 'failed')}</td>
                    <td className="px-4 py-2.5 tabular-nums">{platformCount(p, 'queued')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {stats.recentFailures.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">最近失败</h2>
          <ul className="space-y-2">
            {stats.recentFailures.map((job) => (
              <li key={job.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate">{job.contentItem.title}</span>
                  <span className="ml-4 shrink-0 text-xs uppercase text-muted-foreground">
                    {job.contentItem.language} · {PLATFORM_LABEL[job.platform] ?? job.platform}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-destructive" title={job.error ?? ''}>
                  {job.error}
                </p>
              </li>
            ))}
          </ul>
          <Link href="/records" className="mt-2 inline-block text-xs text-primary hover:underline">
            查看全部发布记录 →
          </Link>
        </section>
      )}
    </div>
  );
}
