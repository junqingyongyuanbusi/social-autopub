'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Account, ConsoleUser, fetchAccounts, fetchUsers, patchAction, postAction, putAction } from '@/lib/api';

const POSTIZ_URL = process.env.NEXT_PUBLIC_POSTIZ_URL ?? '#';

// 账号台账：全员可见（operator 仅见被分配账号）；市场/负责人/用户分配仅 admin 可编辑
export default function AccountsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<ConsoleUser[]>([]);
  const [editing, setEditing] = useState<string>(''); // account id
  const [form, setForm] = useState({ market: '', ownerId: '', note: '' });
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setError('加载失败，请刷新重试'));
    fetchUsers()
      .then(setUsers)
      .catch(() => undefined); // operator 无权限拉用户列表，忽略
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

  const startEdit = (account: Account) => {
    setEditing(account.id);
    setForm({ market: account.market ?? '', ownerId: account.ownerId ?? '', note: account.note ?? '' });
    setAssigned(new Set(account.userLinks?.map((l) => l.userId) ?? []));
  };

  const saveEdit = async (account: Account) => {
    setError('');
    try {
      await patchAction(`/v1/accounts/${account.id}`, {
        market: form.market.trim().toLowerCase() || null,
        ownerId: form.ownerId || null,
        note: form.note.trim() || null,
      });
      await putAction(`/v1/accounts/${account.id}/users`, {
        links: [...assigned].map((userId) => ({ userId, canEdit: true, canPublish: true, canReview: true })),
      });
      setEditing('');
      load();
    } catch {
      setError('保存失败，请重试');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">账号健康</h1>
        {isAdmin && (
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
        )}
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {isAdmin
            ? '还没有账号。请先在 Postiz 完成社媒账号 OAuth 授权，然后点「立即同步」。'
            : '你还没有被分配任何账号，请联系管理员在账号台账中为你授权。'}
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

              {editing === account.id ? (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="block">
                    <span className="mb-0.5 block text-muted-foreground">市场（与路由语言一致，如 id / ja）</span>
                    <input
                      value={form.market}
                      onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
                      className="w-full rounded-md border border-border px-2 py-1.5"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-muted-foreground">负责人</span>
                    <select
                      value={form.ownerId}
                      onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}
                      className="w-full rounded-md border border-border px-2 py-1.5"
                    >
                      <option value="">未指定</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span className="mb-0.5 block text-muted-foreground">授权用户（可见并可操作此账号）</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-border p-2">
                      {users.map((u) => (
                        <label key={u.id} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={assigned.has(u.id)}
                            onChange={(e) =>
                              setAssigned((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(u.id);
                                else next.delete(u.id);
                                return next;
                              })
                            }
                          />
                          {u.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="mb-0.5 block text-muted-foreground">备注</span>
                    <input
                      value={form.note}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                      className="w-full rounded-md border border-border px-2 py-1.5"
                    />
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => saveEdit(account)}
                      className="rounded-md bg-primary px-3 py-1 text-primary-foreground hover:opacity-90"
                    >
                      保存
                    </button>
                    <button onClick={() => setEditing('')} className="rounded-md border border-border px-3 py-1">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <p>市场：{account.market?.toUpperCase() ?? '未设置'}</p>
                  <p>负责人：{account.owner?.name ?? '未指定'}</p>
                  <p>授权用户：{account.userLinks?.length ? account.userLinks.map((l) => l.user?.name).join('、') : '仅管理员'}</p>
                  {account.note && <p>备注：{account.note}</p>}
                  <p className="tabular-nums">
                    上次同步：{account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('zh-CN') : '—'}
                  </p>
                  {isAdmin && (
                    <button onClick={() => startEdit(account)} className="mt-1 text-primary hover:underline">
                      编辑台账
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
