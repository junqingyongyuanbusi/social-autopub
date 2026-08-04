import clsx from 'clsx';

// 内容状态 → 语义色徽章（颜色不作为唯一信息载体，始终带文字）
const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待生成', className: 'bg-muted text-muted-foreground' },
  GENERATING: { label: '生成中', className: 'bg-info/10 text-info' },
  REVIEW: { label: '待审核', className: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已通过', className: 'bg-success/10 text-success' },
  PUBLISHING: { label: '发布中', className: 'bg-info/10 text-info' },
  PUBLISHED: { label: '已发布', className: 'bg-success/10 text-success' },
  FAILED: { label: '失败', className: 'bg-destructive/10 text-destructive' },
  REJECTED: { label: '已驳回', className: 'bg-muted text-muted-foreground' },
  SUPERSEDED: { label: '已作废', className: 'bg-muted text-muted-foreground' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', s.className)}>{s.label}</span>
  );
}
