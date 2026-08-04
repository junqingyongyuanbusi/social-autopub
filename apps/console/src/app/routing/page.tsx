'use client';

import { useCallback, useEffect, useState } from 'react';
import { Account, RoutingRule, deleteAction, fetchAccounts, fetchRouting, patchAction, postAction } from '@/lib/api';

const PLATFORMS = ['x', 'instagram', 'facebook'];
const TYPES = [
  { value: '*', label: '全部类型' },
  { value: 'news', label: '新闻' },
  { value: 'education', label: '教育' },
  { value: 'review', label: '测评' },
  { value: 'exposure', label: '曝光' },
];

// 路由矩阵：语言 × 内容类型 × 平台 → 账号
export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ language: '', contentType: '*', platform: 'x', accountId: '', priority: 0 });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([fetchRouting(), fetchAccounts()])
      .then(([r, a]) => {
        setRules(r);
        setAccounts(a);
      })
      .catch(() => setError('加载失败，请刷新重试'));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    if (!form.language || !form.accountId) {
      setError('语言与账号为必填');
      return;
    }
    setError('');
    try {
      await postAction('/v1/routing', { ...form, language: form.language.toLowerCase() });
      setForm({ language: '', contentType: '*', platform: 'x', accountId: '', priority: 0 });
      load();
    } catch {
      setError('创建失败，请检查输入');
    }
  };

  const toggle = async (rule: RoutingRule) => {
    await patchAction(`/v1/routing/${rule.id}`, { enabled: !rule.enabled });
    load();
  };

  const remove = async (rule: RoutingRule) => {
    if (!confirm(`确认删除路由 ${rule.language}/${rule.contentType}/${rule.platform}？`)) return;
    await deleteAction(`/v1/routing/${rule.id}`);
    load();
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">路由矩阵</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        规则决定「哪种语言的哪类内容发到哪个账号」。同一组合多条规则时 priority 小者优先（容灾备用账号设更大值）。
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">语言（如 en / ja）</span>
          <input
            value={form.language}
            onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            className="w-28 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">内容类型</span>
          <select
            value={form.contentType}
            onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))}
            className="rounded-md border border-border px-2.5 py-1.5"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">平台</span>
          <select
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value, accountId: '' }))}
            className="rounded-md border border-border px-2.5 py-1.5"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">账号（来自 Postiz 同步）</span>
          <select
            value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
            className="min-w-44 rounded-md border border-border px-2.5 py-1.5"
          >
            <option value="">选择账号</option>
            {accounts
              .filter((a) => a.platform.includes(form.platform))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">priority</span>
          <input
            type="number"
            min={0}
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            className="w-20 rounded-md border border-border px-2.5 py-1.5 tabular-nums"
          />
        </label>
        <button
          onClick={create}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          新增规则
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">语言</th>
              <th className="px-4 py-2.5 font-medium">内容类型</th>
              <th className="px-4 py-2.5 font-medium">平台</th>
              <th className="px-4 py-2.5 font-medium">账号</th>
              <th className="px-4 py-2.5 font-medium tabular-nums">priority</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-t border-border">
                <td className="px-4 py-2.5 uppercase">{rule.language}</td>
                <td className="px-4 py-2.5">{TYPES.find((t) => t.value === rule.contentType)?.label ?? rule.contentType}</td>
                <td className="px-4 py-2.5">{rule.platform}</td>
                <td className="px-4 py-2.5">{rule.account?.name}</td>
                <td className="px-4 py-2.5 tabular-nums">{rule.priority}</td>
                <td className="px-4 py-2.5">
                  <span className={rule.enabled ? 'text-success' : 'text-muted-foreground'}>
                    {rule.enabled ? '启用' : '停用'}
                  </span>
                </td>
                <td className="space-x-2 px-4 py-2.5">
                  <button onClick={() => toggle(rule)} className="text-xs text-primary hover:underline">
                    {rule.enabled ? '停用' : '启用'}
                  </button>
                  <button onClick={() => remove(rule)} className="text-xs text-destructive hover:underline">
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
