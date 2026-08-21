"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Image as ImageIcon,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  ContentItem,
  fetchContent,
  InstagramPreview,
  patchAction,
  postAction,
  previewInstagramImage,
} from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";

const PLATFORM_LABEL: Record<string, string> = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

const SOURCE_LABEL: Record<string, string> = {
  notion: "Notion",
  wikifx: "WikiFX 热点",
  http: "HTTP 推送",
};

type RawRecord = Record<string, unknown>;
type WikiFxReviewArticle = {
  url: string | null;
  country: string | null;
  region: string | null;
  metrics: Array<{ label: string; value: number }>;
};

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeHttpUrl(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function readWikiFxArticle(rawPayload: unknown): WikiFxReviewArticle | null {
  const payload = asRecord(rawPayload);
  const article = asRecord(payload?.article);
  if (!article) return null;

  const metricDefinitions = [
    ["浏览", article.view_count],
    ["活跃用户", article.active_users],
    ["平均互动", article.avg_engagement_seconds],
    ["点击", article.click_count],
    ["阅读", article.read_count],
  ] as const;

  return {
    url: safeHttpUrl(article.url ?? article.article_url),
    country: asText(article.country ?? article.content_country),
    region: asText(article.region ?? article.content_region),
    metrics: metricDefinitions.flatMap(([label, value]) => {
      const number = asNumber(value);
      return number === null ? [] : [{ label, value: number }];
    }),
  };
}

interface Draft {
  content: string;
  media: string[];
}

// 审核详情：左侧原文，右侧各平台预览卡（文案 + 图片均可编辑），底部保存/通过/驳回
export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<ContentItem | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [mediaInput, setMediaInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [instagramPreview, setInstagramPreview] = useState<
    InstagramPreview | null
  >(null);
  const [notice, setNotice] = useState<
    {
      kind: "error" | "success";
      text: string;
    } | null
  >(null);

  const load = useCallback(() => {
    fetchContent(id)
      .then((data) => {
        setItem(data);
        setDrafts(
          Object.fromEntries(
            data.generations.map((g) => [
              g.platform,
              { content: g.content, media: [...(g.media ?? [])] },
            ]),
          ),
        );
        setInstagramPreview(null);
      })
      .catch(() => setNotice({ kind: "error", text: "加载失败，请刷新重试" }));
  }, [id]);

  useEffect(load, [load]);

  if (!item) {
    return (
      <p
        role={notice?.kind === "error" ? "alert" : undefined}
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {notice?.text ?? "加载中…"}
      </p>
    );
  }

  const isDirty = (platform: string) => {
    const gen = item.generations.find((g) => g.platform === platform);
    const draft = drafts[platform];
    if (!gen || !draft) return false;
    return (
      draft.content !== gen.content ||
      JSON.stringify(draft.media) !== JSON.stringify(gen.media ?? [])
    );
  };

  const saveDrafts = async () => {
    for (const gen of item.generations) {
      if (isDirty(gen.platform)) {
        const draft = drafts[gen.platform];
        await patchAction(
          `/v1/contents/${item.id}/generations/${gen.platform}`,
          {
            content: draft.content,
            media: draft.media,
          },
        );
      }
    }
  };

  const saveOnly = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await saveDrafts();
      setNotice({ kind: "success", text: "已保存" });
      load();
    } catch {
      setNotice({ kind: "error", text: "保存失败，请重试" });
    } finally {
      setBusy(false);
    }
  };

  const saveAndApprove = async () => {
    // IG 无图会发布失败，前置拦截提示
    const igDraft = drafts["instagram"];
    if (
      igDraft &&
      igDraft.media.length === 0 &&
      !confirm("Instagram 文案没有图片，发布会失败。仍要继续？")
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await saveDrafts();
      await postAction(`/v1/contents/${item.id}/approve`);
      router.push("/review");
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "操作失败，请重试",
      });
      load();
      setBusy(false)
    }
  };

  const reject = async () => {
    if (!confirm("确认驳回这条内容？驳回后不会发布。")) return;
    setBusy(true);
    try {
      await postAction(`/v1/contents/${item.id}/reject`);
      router.push("/review");
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "驳回失败，请重试",
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const addMedia = (platform: string) => {
    const url = (mediaInput[platform] ?? "").trim();
    if (!/^https?:\/\//.test(url)) {
      setNotice({ kind: "error", text: "请输入 http(s) 开头的图片地址" });
      return;
    }
    setDrafts((d) => ({
      ...d,
      [platform]: { ...d[platform], media: [...d[platform].media, url] },
    }));
    setMediaInput((m) => ({ ...m, [platform]: "" }));
    if (platform === "instagram") setInstagramPreview(null);
    setNotice(null);
  };

  const removeMedia = (platform: string, index: number) => {
    setDrafts((d) => ({
      ...d,
      [platform]: {
        ...d[platform],
        media: d[platform].media.filter((_, i) => i !== index),
      },
    }));
    if (platform === "instagram") setInstagramPreview(null);
  };

  const generateInstagramPreview = async (url: string) => {
    setPreviewing(true);
    setNotice(null);
    try {
      setInstagramPreview(await previewInstagramImage(url));
    } catch {
      setNotice({
        kind: "error",
        text: "Instagram 预览生成失败，图片 URL 可能已过期或不可公开访问",
      });
    } finally {
      setPreviewing(false);
    }
  };

  const wikiFxArticle = item.source === "wikifx"
    ? readWikiFxArticle(item.rawPayload)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 dir="auto" className="break-words text-xl font-semibold">
          审核：{item.title}
        </h1>
        <StatusBadge status={item.status} />
      </div>

      {item.lastError && (
        <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">需要处理</p>
            <p className="mt-1 break-words">{item.lastError}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              来源信息
            </h2>
            <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {SOURCE_LABEL[item.source] ?? item.source}
            </span>
            <span className="text-xs uppercase text-muted-foreground">
              {item.language}
            </span>
          </div>
          {wikiFxArticle && (
            <div className="mb-4 space-y-2 rounded-md bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {wikiFxArticle.country && (
                  <span>国家：{wikiFxArticle.country}</span>
                )}
                {wikiFxArticle.region && (
                  <span>地区：{wikiFxArticle.region}</span>
                )}
              </div>
              {wikiFxArticle.metrics.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  {wikiFxArticle.metrics.map((metric) => (
                    <span key={metric.label}>
                      {metric.label}：{metric.value.toLocaleString("zh-CN")}
                    </span>
                  ))}
                </div>
              )}
              {wikiFxArticle.url && (
                <a
                  href={wikiFxArticle.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  查看 WikiFX 原文
                </a>
              )}
            </div>
          )}
          <p
            dir="auto"
            className="whitespace-pre-wrap break-words text-sm leading-relaxed"
          >
            {item.body}
          </p>
        </section>

        <section className="space-y-4">
          {item.generations.map((gen) => {
            const draft = drafts[gen.platform];
            if (!draft) return null;
            const finalPreview = gen.systemSuffix
              ? `${draft.content.trimEnd()}\n\n${gen.systemSuffix}`
              : draft.content
            return (
              <div
                key={gen.platform}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="mb-2 text-sm font-medium">
                  {PLATFORM_LABEL[gen.platform] ?? gen.platform}
                  {gen.platform === "instagram" && draft.media.length === 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-warning">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      IG 发布必须有图片
                    </span>
                  )}
                </h3>
                <textarea
                  dir="auto"
                  aria-label={`${PLATFORM_LABEL[gen.platform] ?? gen.platform} 文案`}
                  className="min-h-32 w-full resize-y rounded-md border border-border p-3 text-sm leading-relaxed focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={draft.content}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [gen.platform]: {
                        ...d[gen.platform],
                        content: e.target.value,
                      },
                    }))}
                />
                {gen.previewProblem && (
                  <p className="mt-2 text-xs text-destructive">{gen.previewProblem}</p>
                )}
                {gen.systemSuffix && (
                  <div className="mt-2 rounded-md border border-dashed border-border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      系统发布尾注（不可编辑）
                    </p>
                    <p dir="auto" className="mt-1 whitespace-pre-wrap break-all text-sm">
                      {gen.systemSuffix}
                    </p>
                  </div>
                )}
                <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                  {isDirty(gen.platform)
                    ? `${finalPreview.length} 可见字符（保存后按平台规则校验）`
                    : `${gen.measuredLength ?? finalPreview.length}${
                        gen.platformLimit ? ` / ${gen.platformLimit}` : ""
                      } 平台计权字符`}
                </p>

                {draft.media.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.media.map((url, i) => (
                      <div key={`${url}-${i}`} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`配图 ${i + 1}`}
                          className="h-20 w-20 rounded-md border border-border object-cover"
                        />
                        <button
                          onClick={() =>
                            removeMedia(gen.platform, i)}
                          aria-label={`删除 ${PLATFORM_LABEL[gen.platform] ?? gen.platform} 配图 ${i + 1}`}
                          className="absolute -right-1.5 -top-1.5 inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-destructive text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {gen.platform === "instagram" && draft.media[0] && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        4:5 发布预览
                      </span>
                      <button
                        type="button"
                        onClick={() => generateInstagramPreview(draft.media[0])}
                        disabled={previewing}
                        className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:border-primary hover:text-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                      >
                        {previewing
                          ? (
                            <LoaderCircle
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                          )
                          : <ImageIcon className="size-3.5" aria-hidden />}
                        {previewing ? "正在转换" : "生成预览"}
                      </button>
                    </div>
                    {instagramPreview && (
                      <div className="mx-auto w-full max-w-56 overflow-hidden rounded-md border border-border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={instagramPreview.dataUrl}
                          alt="Instagram 4:5 转换预览"
                          className="aspect-[4/5] w-full object-contain"
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={mediaInput[gen.platform] ?? ""}
                    onChange={(e) =>
                      setMediaInput((m) => ({
                        ...m,
                        [gen.platform]: e.target.value,
                      }))}
                    aria-label={`添加 ${PLATFORM_LABEL[gen.platform] ?? gen.platform} 配图 URL`}
                    placeholder="粘贴图片 URL 添加配图"
                    className="min-h-10 flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                  <button
                    onClick={() => addMedia(gen.platform)}
                    className="min-h-10 rounded-md border border-border px-3 text-xs hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    添加
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {notice && (
        <p
          className={`text-sm ${
            notice.kind === "error" ? "text-destructive" : "text-success"
          }`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.text}
        </p>
      )}
      {item.status === "REVIEW" && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={saveAndApprove}
            disabled={busy}
            className="min-h-10 rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {busy ? "处理中…" : "通过并发布"}
          </button>
          <button
            onClick={saveOnly}
            disabled={busy}
            className="min-h-10 rounded-md border border-border px-5 py-2 text-sm hover:border-primary hover:text-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            仅保存修改
          </button>
          <button
            onClick={reject}
            disabled={busy}
            className="min-h-10 rounded-md border border-border px-5 py-2 text-sm text-muted-foreground hover:border-destructive hover:text-destructive active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50"
          >
            驳回
          </button>
        </div>
      )}
    </div>
  );
}
