import { fetchContents } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

// 发布日历（P2 简版）：按日期分组展示未来的定时任务与近期已发布；拖拽调整属后续迭代
export default async function CalendarPage() {
  const items = await fetchContents().catch(() => []);
  const dated = items
    .filter((i) => i.publishAt || ['PUBLISHING', 'PUBLISHED'].includes(i.status))
    .sort((a, b) => (a.publishAt ?? a.createdAt).localeCompare(b.publishAt ?? b.createdAt));

  const groups = new Map<string, typeof dated>();
  for (const item of dated) {
    const day = new Date(item.publishAt ?? item.createdAt).toLocaleDateString('zh-CN', { dateStyle: 'full' });
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">发布日历</h1>
      {groups.size === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无定时或已发布的内容。
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{day}</h2>
              <ul className="space-y-2">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="ml-4 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {new Date(item.publishAt ?? item.createdAt).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="uppercase">{item.language}</span>
                      <StatusBadge status={item.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
