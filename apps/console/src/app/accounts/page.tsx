'use client';

import { useCallback, useEffect, useState } from 'react';
import { Account, fetchAccounts, postAction } from '@/lib/api';

const POSTIZ_URL = process.env.NEXT_PUBLIC_POSTIZ_URL ?? '#';

// 账号健康：Postiz integrations 镜像；授权失效的账号去 Postiz 重新连接
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setError('加载失败，请刷新重试'));
  }, []);

  useEffect(load, [load]);

  const syncNow = async () => {
    setSyncing(true);
    setError('');
    try {
      const updated = (await postAction('/v1/accounts/sync')) as Account[];
      setAccounts(updated);
    } catch {
      setError('同步失败，请确认 Postiz 服务与 API Key 配置');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">账号健康</h1>
        <div className="flex gap-2">
          <button
            onClick={syncNow}
            disabled={syncing}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <a
            href={POSTIZ_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            去 Postiz 连接账号
          </a>
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          还没有账号。请先在 Postiz 中完成社媒账号 OAuth 授权，然后点「立即同步」。
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <div key={account.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{account.name}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    account.status === 'active' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {account.status === 'active' ? '正常' : '失联'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{account.platform}</p>
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                上次同步：{account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('zh-CN') : '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
