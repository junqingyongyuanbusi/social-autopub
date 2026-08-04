"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, RotateCcw, Save, Undo2 } from "lucide-react";
import {
  PromptConfig,
  PromptVersion,
  fetchPrompts,
  postAction,
} from "@/lib/api";

type EditablePrompt = Omit<PromptConfig, "id" | "version">;

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

const TONE_LABELS: Record<string, string> = {
  news: "新闻",
  education: "教育",
  review: "测评",
  exposure: "曝光",
};

const GENERATION_TOKENS = [
  "{{platform}}",
  "{{language}}",
  "{{contentType}}",
  "{{typeTone}}",
  "{{platformRule}}",
  "{{title}}",
  "{{body}}",
];
const REVISION_TOKENS = [
  "{{platform}}",
  "{{language}}",
  "{{content}}",
  "{{problems}}",
];

function editable(config: PromptConfig): EditablePrompt {
  return {
    systemPrompt: config.systemPrompt,
    generationTemplate: config.generationTemplate,
    revisionTemplate: config.revisionTemplate,
    platformRules: { ...config.platformRules },
    typeTones: { ...config.typeTones },
  };
}

function TokenList({ tokens }: { tokens: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="可用模板变量">
      {tokens.map((token) => (
        <code
          key={token}
          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          {token}
        </code>
      ))}
    </div>
  );
}

export default function PromptsPage() {
  const [active, setActive] = useState<PromptConfig | null>(null);
  const [defaults, setDefaults] = useState<PromptConfig | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [form, setForm] = useState<EditablePrompt | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchPrompts();
      setActive(data.active);
      setDefaults(data.defaults);
      setVersions(data.versions);
      setForm(editable(data.active));
      setError("");
    } catch {
      setError("Prompt 配置加载失败，请刷新重试");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(() => {
    if (!active || !form) return false;
    return JSON.stringify(editable(active)) !== JSON.stringify(form);
  }, [active, form]);

  const publish = async () => {
    if (!form || !changed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction("/v1/prompts", { ...form, changeNote });
      await load();
      setChangeNote("");
      setNotice("新 Prompt 版本已发布");
    } catch {
      setError("发布失败，请检查模板必填变量和字段长度");
    } finally {
      setBusy(false);
    }
  };

  const activate = async (version: PromptVersion) => {
    if (
      version.active ||
      !confirm(`确认将 Prompt 回滚到 v${version.version}？`)
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction(`/v1/prompts/${version.id}/activate`);
      await load();
      setNotice(`已激活 Prompt v${version.version}`);
    } catch {
      setError("版本激活失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  if (!form || !active || !defaults) {
    return (
      <div className="text-sm text-muted-foreground">
        {error || "正在加载 Prompt 配置..."}
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Prompt 管理</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            当前版本 {active.version === 0 ? "内置默认" : `v${active.version}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setForm(editable(defaults))}
            disabled={busy}
            className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="size-4" aria-hidden />
            恢复内置默认
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={busy || !changed}
            className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="size-4" aria-hidden />
            {busy ? "正在发布" : "发布新版本"}
          </button>
        </div>
      </div>

      {(error || notice) && (
        <p
          className={`mb-4 text-sm ${error ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {error || notice}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <label
              className="block text-sm font-medium"
              htmlFor="system-prompt"
            >
              System Prompt
            </label>
            <textarea
              id="system-prompt"
              value={form.systemPrompt}
              onChange={(event) =>
                setForm(
                  (current) =>
                    current && { ...current, systemPrompt: event.target.value },
                )
              }
              rows={5}
              className="mt-2 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-6 focus:border-primary focus:outline-none"
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="generation-template"
              >
                首次生成模板
              </label>
              <TokenList tokens={GENERATION_TOKENS} />
            </div>
            <textarea
              id="generation-template"
              value={form.generationTemplate}
              onChange={(event) =>
                setForm(
                  (current) =>
                    current && {
                      ...current,
                      generationTemplate: event.target.value,
                    },
                )
              }
              rows={15}
              className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-6 focus:border-primary focus:outline-none"
              spellCheck={false}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="revision-template"
              >
                校正模板
              </label>
              <TokenList tokens={REVISION_TOKENS} />
            </div>
            <textarea
              id="revision-template"
              value={form.revisionTemplate}
              onChange={(event) =>
                setForm(
                  (current) =>
                    current && {
                      ...current,
                      revisionTemplate: event.target.value,
                    },
                )
              }
              rows={10}
              className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-6 focus:border-primary focus:outline-none"
              spellCheck={false}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">平台规则</h2>
            <div className="mt-3 divide-y divide-border">
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                <label
                  key={key}
                  className="grid gap-2 py-3 md:grid-cols-[8rem_minmax(0,1fr)] md:items-start"
                >
                  <span className="pt-2 text-sm font-medium">{label}</span>
                  <textarea
                    value={form.platformRules[key] ?? ""}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && {
                            ...current,
                            platformRules: {
                              ...current.platformRules,
                              [key]: event.target.value,
                            },
                          },
                      )
                    }
                    rows={3}
                    className="w-full resize-y rounded-md border border-border bg-background p-2.5 text-sm leading-6 focus:border-primary focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">内容类型语气</h2>
            <div className="mt-3 divide-y divide-border">
              {Object.entries(TONE_LABELS).map(([key, label]) => (
                <label
                  key={key}
                  className="grid gap-2 py-3 md:grid-cols-[8rem_minmax(0,1fr)] md:items-center"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <input
                    value={form.typeTones[key] ?? ""}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && {
                            ...current,
                            typeTones: {
                              ...current.typeTones,
                              [key]: event.target.value,
                            },
                          },
                      )
                    }
                    className="min-h-10 w-full rounded-md border border-border bg-background px-2.5 text-sm focus:border-primary focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <label className="block text-sm font-medium" htmlFor="change-note">
              版本说明
            </label>
            <input
              id="change-note"
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
              maxLength={500}
              className="mt-2 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
              placeholder="例如：加强 X 文案的事实核验与风险提示"
            />
          </section>
        </div>

        <aside className="rounded-lg border border-border bg-card xl:sticky xl:top-6">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Clock3 className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">版本历史</h2>
          </div>
          {versions.length ? (
            <div className="divide-y divide-border">
              {versions.map((version) => (
                <div key={version.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        v{version.version}
                      </span>
                      {version.active && (
                        <span className="text-xs font-medium text-success">
                          当前
                        </span>
                      )}
                    </div>
                    {!version.active && (
                      <button
                        type="button"
                        onClick={() => activate(version)}
                        disabled={busy}
                        className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-primary hover:bg-muted disabled:opacity-50"
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                        激活
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString("zh-CN")}
                  </p>
                  {version.changeNote && (
                    <p className="mt-2 text-sm leading-5">
                      {version.changeNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              尚未发布数据库版本
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
