'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConsoleUser, deleteAction, fetchUsers, patchAction, postAction } from '@/lib/api';

// 设置页 · 用户管理区块：列表 / 新建 / 重置密码 / 删除
export function UserManager() {
  const [users, setUsers] = useState<ConsoleUser[]>([]);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'operator' });
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    fetchUsers()
      .then(setUsers)
      .catch(() => setNotice('用户列表加载失败'));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    if (!form.email || !form.name || form.password.length < 8) {
      setNotice('请完整填写，密码至少 8 位');
      return;
    }
    setNotice('');
    try {
      await postAction('/v1/users', form);
      setForm({ email: '', name: '', password: '', role: 'operator' });
      load();
    } catch {
      setNotice('创建失败：邮箱可能已存在');
    }
  };

  const resetPassword = async (user: ConsoleUser) => {
    const password = prompt(`为 ${user.name} 设置新密码（至少 8 位）：`);
    if (!password) return;
    if (password.length < 8) {
      setNotice('密码至少 8 位');
      return;
    }
    await patchAction(`/v1/users/${user.id}`, { password });
    setNotice(`已重置 ${user.name} 的密码`);
  };

  const remove = async (user: ConsoleUser) => {
    if (!confirm(`确认删除用户 ${user.name}（${user.email}）？`)) return;
    try {
      await deleteAction(`/v1/users/${user.id}`);
      load();
    } catch {
      setNotice('删除失败：不能删除最后一个管理员');
    }
  };

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold">用户管理</h2>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-56 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">姓名</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-28 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">初始密码（≥8 位）</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-40 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">角色</span>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="rounded-md border border-border px-2.5 py-1.5"
          >
            <option value="operator">运营</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <button
          onClick={create}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          新建用户
        </button>
      </div>
      {notice && <p className="mb-3 text-sm text-destructive">{notice}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">姓名</th>
              <th className="px-4 py-2.5 font-medium">邮箱</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium tabular-nums">创建时间</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-border">
                <td className="px-4 py-2.5">{user.name}</td>
                <td className="px-4 py-2.5">{user.email}</td>
                <td className="px-4 py-2.5">{user.role === 'admin' ? '管理员' : '运营'}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                </td>
                <td className="space-x-2 px-4 py-2.5">
                  <button onClick={() => resetPassword(user)} className="text-xs text-primary hover:underline">
                    重置密码
                  </button>
                  <button onClick={() => remove(user)} className="text-xs text-destructive hover:underline">
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
