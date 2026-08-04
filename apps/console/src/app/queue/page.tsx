import Link from 'next/link';
import { fetchContents } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = { news: '新闻', education: '教育', review: '测评', exposure: '曝光' };

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; language?: string }>;
}) {
  const params = await searchParams;
  const items = await fetchContents(params).catch(() => []);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">内容队列</h1>
      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无内容。Notion 表中将「发布状态」改为「可发布」，或通过 POST /v1/ingest 推送内容后，任务会出现在这里。
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">标题</th>
                <th className="px-4 py-2.5 font-medium">语言</th>
                <th className="px-4 py-2.5 font-medium">类型</th>
                <th className="px-4 py-2.5 font-medium">来源</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium tabular-nums">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                  <td className="max-w-md truncate px-4 py-2.5">
                    <Link href={`/review/${item.id}`} className="hover:text-primary hover:underline">
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 uppercase">{item.language}</td>
                  <td className="px-4 py-2.5">{TYPE_LABEL[item.contentType] ?? item.contentType}</td>
                  <td className="px-4 py-2.5">{item.source}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
