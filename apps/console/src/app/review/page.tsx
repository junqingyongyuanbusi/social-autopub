import { fetchContents } from '@/lib/api';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

// 审核列表：仅展示 REVIEW 状态，点击进入详情工作台
export default async function ReviewListPage() {
  const items = await fetchContents({ status: 'REVIEW' }).catch(() => []);
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">审核工作台</h1>
      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          没有待审核的内容。
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/review/${item.id}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:border-primary"
              >
                <span className="truncate text-sm">{item.title}</span>
                <span className="ml-4 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="uppercase">{item.language}</span>
                  <span>{item.generations.length} 个平台</span>
                  <StatusBadge status={item.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
