"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteAction,
  fetchSources,
  patchAction,
  postAction,
  SourceDatabase,
} from "@/lib/api";
import { UserManager } from "@/components/user-manager";

// 设置：Notion 数据源注册表（20 张表在此登记，免直接操作数据库）
export default function SettingsPage() {
  const [sources, setSources] = useState<SourceDatabase[]>([]);
  const [form, setForm] = useState({
    notionDatabaseId: "",
    language: "",
    tableType: "main",
  });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchSources()
      .then(setSources)
      .catch(() => setError("加载失败，请刷新重试"));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    if (!form.notionDatabaseId || !form.language) {
      setError("Notion Database ID 与语言为必填");
      return;
    }
    setError("");
    try {
      await postAction("/v1/sources", {
        ...form,
        language: form.language.toLowerCase(),
      });
      setForm({ notionDatabaseId: "", language: "", tableType: "main" });
      load();
    } catch {
      setError("创建失败：Database ID 可能已存在或格式不正确");
    }
  };

  const toggle = async (src: SourceDatabase) => {
    await patchAction(`/v1/sources/${src.id}`, { enabled: !src.enabled });
    load();
  };

  const remove = async (src: SourceDatabase) => {
    if (
      !confirm(
        `确认删除数据源 ${src.language}/${src.tableType}？已入库的内容不受影响。`,
      )
    ) return;
    await deleteAction(`/v1/sources/${src.id}`);
    load();
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">设置</h1>
      <h2 className="mb-3 text-base font-semibold">Notion 数据源</h2>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Notion Database ID
          </span>
          <input
            value={form.notionDatabaseId}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                notionDatabaseId: e.target.value.trim(),
              }))}
            className="min-h-10 w-full max-w-80 rounded-md border border-border px-2.5 py-1.5 font-mono text-xs focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            placeholder="从 Notion 数据库链接中复制 32 位 ID"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">语言</span>
          <input
            value={form.language}
            onChange={(e) =>
              setForm((f) => ({ ...f, language: e.target.value }))}
            className="min-h-10 w-24 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            placeholder="en"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            表类型
          </span>
          <input
            value={form.tableType}
            onChange={(e) =>
              setForm((f) => ({ ...f, tableType: e.target.value }))}
            className="min-h-10 w-28 rounded-md border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </label>
        <button
          onClick={create}
          className="min-h-10 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          登记数据源
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">WikiFX API</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          WikiFX 热点 API 由 API 服务读取环境变量配置。Key
          不在此页面显示或编辑；此处不提供“已配置”状态，避免把连接状态误读为真实探测结果。
        </p>
        <a
          href="/topics"
          className="mt-3 inline-flex min-h-10 items-center rounded-md border border-primary px-3 text-sm text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          前往热点选题测试连接
        </a>
      </section>

      <h2 className="mb-3 text-base font-semibold">Notion 数据源列表</h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Database ID</th>
              <th className="px-4 py-2.5 font-medium">语言</th>
              <th className="px-4 py-2.5 font-medium">表类型</th>
              <th className="px-4 py-2.5 font-medium tabular-nums">上次轮询</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => (
              <tr key={src.id} className="border-t border-border">
                <td className="px-4 py-2.5 font-mono text-xs">
                  {src.notionDatabaseId}
                </td>
                <td className="px-4 py-2.5 uppercase">{src.language}</td>
                <td className="px-4 py-2.5">{src.tableType}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                  {src.lastPolledAt
                    ? new Date(src.lastPolledAt).toLocaleString("zh-CN")
                    : "未轮询"}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={src.enabled
                      ? "text-success"
                      : "text-muted-foreground"}
                  >
                    {src.enabled ? "启用" : "停用"}
                  </span>
                </td>
                <td className="space-x-2 px-4 py-2.5">
                  <button
                    onClick={() =>
                      toggle(src)}
                    className="inline-flex min-h-10 items-center text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {src.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    onClick={() =>
                      remove(src)}
                    className="inline-flex min-h-10 items-center text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserManager />
    </div>
  );
}
