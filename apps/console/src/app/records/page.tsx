'use client';

import { useCallback, useEffect, useState } from 'react';
import { PublishJobRow, fetchJobs, postAction } from '@/lib/api';

const PLATFORM_LABEL: Record<string, string> = { x: 'X', instagram: 'Instagram', facebook: 'Facebook' };
const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  queued: { label: '队列中', className: 'bg-info/10 text-info' },
  publishing: { label: '发布中', className: 'bg-warning/10 text-warning' },
  sent: { label: '已提交', className: 'bg-success/10 text-success' },
  failed: { label: '失败', className: 'bg-destructive/10 text-destructive' },
  unknown: { label: '待对账', className: 'bg-warning/20 text-warning' },
};

// 发布记录：全部子任务流水，失败可重试
export default function RecordsPage() {
  const [jobs, setJobs] = useState<PublishJobRow[]>([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchJobs()
      .then(setJobs)
      .catch(() => setError('加载失败，请刷新重试'));
  }, []);

  useEffect(load, [load]);

  const retry = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await postAction(`/v1/jobs/${id}/retry`);
      load();
    } catch {
      setError('重试请求失败');
    } finally {
      setBusyId('');
    }
  };

  const resolveUnknown = async (id: string, outcome: 'sent' | 'failed') => {
    const postizPostId =
      outcome === 'sent'
        ? window.prompt('请输入在 Postiz 核实到的 post ID')?.trim()
        : undefined;
    if (outcome === 'sent' && !postizPostId) return;
    if (
      outcome === 'failed' &&
      !window.confirm('确认 Postiz/目标平台没有发送该帖子，并允许后续安全重试？')
    ) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await postAction(`/v1/jobs/${id}/resolve-unknown`, {
        outcome,
        ...(postizPostId ? { postizPostId } : {}),
      });
      load();
    } catch {
      setError('对账操作失败，请刷新后重试');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">发布记录</h1>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          还没有发布记录。
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">内容</th>
                <th className="px-4 py-2.5 font-medium">语言</th>
                <th className="px-4 py-2.5 font-medium">平台</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">失败原因</th>
                <th className="px-4 py-2.5 font-medium tabular-nums">时间</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const s = STATUS_LABEL[job.status] ?? { label: job.status, className: 'bg-muted text-muted-foreground' };
                return (
                  <tr key={job.id} className="border-t border-border">
                    <td className="max-w-xs truncate px-4 py-2.5">{job.contentItem?.title}</td>
                    <td className="px-4 py-2.5 uppercase">{job.contentItem?.language}</td>
                    <td className="px-4 py-2.5">{PLATFORM_LABEL[job.platform] ?? job.platform}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="max-w-sm truncate px-4 py-2.5 text-xs text-muted-foreground" title={job.error ?? ''}>
                      {job.error ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2.5">
                      {job.status === 'failed' && (
                        <button
                          onClick={() => retry(job.id)}
                          disabled={busyId === job.id}
                          className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {busyId === job.id ? '重试中…' : '重试'}
                        </button>
                      )}
                      {job.status === 'unknown' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => resolveUnknown(job.id, 'sent')}
                            disabled={busyId === job.id}
                            className="rounded-md border border-success/50 px-2 py-1 text-xs text-success disabled:opacity-50"
                          >
                            确认已发送
                          </button>
                          <button
                            onClick={() => resolveUnknown(job.id, 'failed')}
                            disabled={busyId === job.id}
                            className="rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive disabled:opacity-50"
                          >
                            确认未发送
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
