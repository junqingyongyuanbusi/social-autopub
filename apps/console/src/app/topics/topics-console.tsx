"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  adoptWikiFxTopic,
  fetchWikiFxArticleByUrl,
  WikiFxFetchByUrlResponse,
  WikiFxTopic,
  WikiFxTopicsResponse,
} from "@/lib/api";
import { parseWikiFXArticleUrl } from "@/lib/wikifx-url";

const DAY_OPTIONS = [1, 2, 3];
const CACHE_LABEL: Record<WikiFxTopicsResponse["cache"]["status"], string> = {
  upstream: "上游最新",
  "local-fresh": "本地新鲜缓存",
  "local-stale": "本地过期缓存",
};
const CACHE_STYLE: Record<WikiFxTopicsResponse["cache"]["status"], string> = {
  upstream: "bg-success/10 text-success",
  "local-fresh": "bg-info/10 text-info",
  "local-stale": "bg-warning/10 text-warning",
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatEngagement(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function ManualFetchCard() {
  const [url, setUrl] = useState("");
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [result, setResult] = useState<WikiFxFetchByUrlResponse | null>(null);
  const [error, setError] = useState("");
  const [localError, setLocalError] = useState("");
  const [adopted, setAdopted] = useState<{
    content_item_id: string;
    status: string;
  } | null>(null);

  const fetchNow = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setLocalError("请输入 WikiFX 文章链接");
      return;
    }
    let target;
    try {
      target = parseWikiFXArticleUrl(trimmed);
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "链接格式不正确",
      );
      return;
    }
    setLocalError("");
    setError("");
    setResult(null);
    setAdopted(null);
    setLoading(true);
    try {
      const data = await fetchWikiFxArticleByUrl(target.canonicalUrl, force);
      setResult(data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "抓取失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  };

  const adopt = async () => {
    if (!result || adopting) return;
    setAdopting(true);
    setError("");
    try {
      const adopted = await adoptWikiFxTopic({
        article_id: result.article.article_id,
        language: result.article.language,
        manual: true,
      });
      setAdopted({
        content_item_id: adopted.content_item_id,
        status: adopted.status,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "采用失败，请重试。",
      );
    } finally {
      setAdopting(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-label="手动抓取 WikiFX 文章"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">手动抓取</h2>
        <span className="text-xs text-muted-foreground">
          粘贴 WikiFX newsdetail 链接，抓取正文后采用进入审核队列。链接不会被转发，只提取语言与文章 ID。
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (localError) setLocalError("");
            if (error) setError("");
            setResult(null);
            setAdopted(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) void fetchNow();
          }}
          placeholder="https://www.wikifx.com/ja/newsdetail/202608202624732011.html"
          aria-label="WikiFX 文章链接"
          className="min-h-10 w-full min-w-0 flex-1 rounded-md border border-border px-2.5 sm:max-w-md focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="text-muted-foreground">强制抓取</span>
        </label>
        <button
          type="button"
          onClick={() => void fetchNow()}
          disabled={loading || !url.trim()}
          className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "抓取中…" : "抓取并预览"}
        </button>
      </div>
      {localError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {localError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase">
              {result.article.language}
            </span>
            <span className="text-sm font-medium">{result.article.title}</span>
            <span className="text-xs text-muted-foreground">
              文章 ID：{result.article.article_id}
            </span>
            {result.origin === "cache" && (
              <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">
                读取正文库缓存
              </span>
            )}
          </div>
          {result.article.first_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.article.first_image_url}
              alt="文章首图"
              width={320}
              height={180}
              loading="lazy"
              className="mt-2 max-h-44 w-auto rounded-md border border-border object-contain"
            />
          )}
          <p
            dir="auto"
            className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
          >
            {result.article.content}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {result.article.url && (
              <a
                href={result.article.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                查看原文
              </a>
            )}
            {adopted ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-sm text-success">
                已采用 · {adopted.status}
                <Link
                  href={`/review/${adopted.content_item_id}`}
                  className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  去审核
                </Link>
                <Link
                  href="/queue?source=wikifx"
                  className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  看队列
                </Link>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void adopt()}
                disabled={adopting || !result.article.content?.trim()}
                title={!result.article.content?.trim()
                  ? "正文不可用，暂时不能采用"
                  : undefined}
                className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adopting ? "采用中…" : "采用并进入队列"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const FAILED_CONTENT_STATES = new Set([
  "empty",
  "not_found",
  "blocked",
  "timeout",
  "error",
  "fetch_failed",
  "not_fetched",
  "content_not_fetched",
]);

function contentState(topic: WikiFxTopic) {
  if (topic.content_status && FAILED_CONTENT_STATES.has(topic.content_status)) {
    if (topic.content_message?.trim()) return topic.content_message;
    return topic.content_status;
  }
  if (topic.content?.trim()) return "正文可用";
  if (topic.content_message?.trim()) return topic.content_message;
  if (topic.content_status?.trim()) return topic.content_status;
  return "正文不可用";
}

function hasUsableContent(topic: Pick<WikiFxTopic, "content" | "content_status">) {
  return Boolean(
    topic.content?.trim() &&
      !(topic.content_status && FAILED_CONTENT_STATES.has(topic.content_status)),
  );
}

export function TopicsConsole(
  { initialData }: { initialData: WikiFxTopicsResponse },
) {
  const [data, setData] = useState(initialData);
  const [language, setLanguage] = useState("");
  const [country, setCountry] = useState("");
  const [keyword, setKeyword] = useState("");
  const [adoption, setAdoption] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<
    { kind: "success" | "error"; text: string; contentItemId?: string } | null
  >(null);

  const languages = useMemo(
    () => [...new Set(data.items.map((item) => item.language))].sort(),
    [data.items],
  );
  const countries = useMemo(
    () =>
      [
        ...new Set(data.items.flatMap((item) =>
          [item.country, item.region].filter(Boolean) as string[]
        )),
      ].sort(),
    [data.items],
  );
  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return data.items.filter((item) => {
      const matchesLanguage = !language || item.language === language;
      const matchesCountry = !country || item.country === country ||
        item.region === country;
      const searchableText = [item.title, item.content, item.country, item.region]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      const matchesKeyword = !normalizedKeyword ||
        searchableText.includes(normalizedKeyword);
      const matchesAdoption = adoption === "all" ||
        (adoption === "adopted" ? Boolean(item.adoption) : !item.adoption);
      return matchesLanguage && matchesCountry && matchesKeyword &&
        matchesAdoption;
    });
  }, [adoption, country, data.items, keyword, language]);

  const adopt = async (topic: WikiFxTopic) => {
    if (topic.adoption || !hasUsableContent(topic) || busyId) return;
    setBusyId(topic.id);
    setNotice(null);
    try {
      const result = await adoptWikiFxTopic({
        article_id: topic.article_id,
        language: topic.language,
        days: data.days,
      });
      setData((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === topic.id
            ? {
              ...item,
              adoption: {
                content_item_id: result.content_item_id,
                status: result.status,
                created_at: result.created_at,
              },
            }
            : item
        ),
      }));
      setNotice({
        kind: "success",
        text: `已采用「${topic.title}」，内容已进入队列。`,
        contentItemId: result.content_item_id,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "采用失败，请重试。",
      });
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="space-y-4">
      <ManualFetchCard />
      <section className="rounded-lg border border-border bg-card p-4" aria-label="统计信息">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">统计区间</span>
          <span className="tabular-nums">
            {new Date(data.statistics_start).toLocaleDateString("zh-CN")} 至
            {" "}
            {new Date(data.statistics_end).toLocaleDateString("zh-CN")}
          </span>
          <span className="text-muted-foreground">
            按完整自然日统计，非实时滚动窗口
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              CACHE_STYLE[data.cache.status]
            }`}
          >
            {CACHE_LABEL[data.cache.status]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            抓取时间：{new Date(data.cache.fetched_at).toLocaleString("zh-CN")}
          </span>
          {data.cache.age && <span>上游缓存年龄：{data.cache.age}</span>}
          <span>
            共 {data.items.length} 条，当前显示 {filteredItems.length} 条
          </span>
        </div>
        {(data.data_quality.sampled ||
          data.data_quality.data_loss_from_other_row ||
          data.data_quality.skipped_rows > 0) && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            数据质量提示：{data.data_quality.sampled ? "结果为抽样数据；" : ""}
            {data.data_quality.data_loss_from_other_row
              ? "存在其他行数据损失；"
              : ""}
            {data.data_quality.skipped_rows > 0
              ? `跳过 ${data.data_quality.skipped_rows} 行。`
              : ""}
          </p>
        )}
      </section>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(event) => event.preventDefault()}
        aria-label="热点选题筛选"
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">语言</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">全部语言</option>
            {languages.map((value) => (
              <option key={value} value={value}>{value.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            国家 / 地区
          </span>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">全部国家 / 地区</option>
            {countries.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-sm sm:max-w-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            关键词
          </span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题、正文或地区"
            className="min-h-10 w-full rounded-md border border-border px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            采用状态
          </span>
          <select
            value={adoption}
            onChange={(event) => setAdoption(event.target.value)}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="all">全部状态</option>
            <option value="unadopted">未采用</option>
            <option value="adopted">已采用</option>
          </select>
        </label>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-label="统计天数">
        <span className="mr-1 text-sm text-muted-foreground">统计天数</span>
        {DAY_OPTIONS.map((value) => (
          <Link
            key={value}
            href={`/topics?days=${value}`}
            className={`inline-flex min-h-10 items-center rounded-md border px-3 text-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              data.days === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary hover:text-primary"
            }`}
          >
            {value} 天
          </Link>
        ))}
      </div>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm ${
            notice.kind === "error" ? "text-destructive" : "text-success"
          }`}
        >
          {notice.text}
          {notice.kind === "success" && notice.contentItemId && (
            <span className="ml-2 inline-flex flex-wrap gap-2">
              <Link
                href={`/review/${notice.contentItemId}`}
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                去审核
              </Link>
              <Link
                href="/queue?source=wikifx"
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                看队列
              </Link>
            </span>
          )}
        </p>
      )}

      {filteredItems.length === 0
        ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            没有符合筛选条件的热点选题。
          </div>
        )
        : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card" aria-label="热点选题列表">
            <table className="w-full min-w-[960px] text-sm" aria-live="polite">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">选题</th>
                  <th className="px-4 py-2.5 font-medium">热度指标</th>
                  <th className="px-4 py-2.5 font-medium">正文 / 首图</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((topic) => (
                  <tr
                    key={topic.id}
                    className="border-t border-border align-top hover:bg-muted/20"
                  >
                    <td className="max-w-[30rem] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium uppercase">
                          {topic.language}
                        </span>
                        <span>
                          {topic.country || topic.region || "国家 / 地区未提供"}
                        </span>
                      </div>
                      <h2
                        dir="auto"
                        className="mt-1 break-words font-medium leading-6"
                      >
                        {topic.title}
                      </h2>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        文章 ID：{topic.article_id}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      <div>浏览 {formatMetric(topic.view_count)}</div>
                      <div>活跃 {formatMetric(topic.active_users)}</div>
                      <div>
                        平均互动{" "}
                        {formatEngagement(topic.avg_engagement_seconds)}
                      </div>
                      {topic.click_count !== null && (
                        <div>点击 {formatMetric(topic.click_count)}</div>
                      )}
                      {topic.read_count !== null && (
                        <div>阅读 {formatMetric(topic.read_count)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div
                        className={hasUsableContent(topic)
                          ? "text-success"
                          : "text-warning"}
                      >
                        {contentState(topic)}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {topic.first_image_url ? "首图可用" : "无首图"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {topic.adoption
                        ? (
                          <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 font-medium text-success">
                            已采用 · {topic.adoption.status}
                          </span>
                        )
                        : (
                          <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground">
                            未采用
                          </span>
                        )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {topic.url
                          ? (
                            <a
                              href={topic.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-xs hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              查看原文
                            </a>
                          )
                          : (
                            <span className="inline-flex min-h-10 items-center text-xs text-muted-foreground">
                              原文链接不可用
                            </span>
                          )}
                        {topic.adoption
                          ? (
                            <Link
                              href={`/review/${topic.adoption.content_item_id}`}
                              className="inline-flex min-h-10 items-center rounded-md border border-primary px-3 text-xs text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              查看内容
                            </Link>
                          )
                          : (
                            <button
                              type="button"
                              onClick={() => adopt(topic)}
                              disabled={busyId !== "" || !hasUsableContent(topic)}
                              title={!hasUsableContent(topic)
                                ? "正文不可用，暂时不能采用"
                                : undefined}
                              className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busyId === topic.id
                                ? "采用中…"
                                : hasUsableContent(topic)
                                ? "采用选题"
                                : "正文不可用"}
                            </button>
                          )}
                      </div>
                      <details className="mt-2 max-w-md">
                        <summary className="cursor-pointer text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          展开详情
                        </summary>
                        <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-3 text-xs leading-5">
                          <p
                            dir="auto"
                            className="whitespace-pre-wrap break-words"
                          >
                            {hasUsableContent(topic)
                              ? topic.content
                              : contentState(topic)}
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground tabular-nums" aria-label="详细热度指标">
                            <span>浏览 {formatMetric(topic.view_count)}</span>
                            <span>活跃 {formatMetric(topic.active_users)}</span>
                            <span>
                              平均互动{" "}
                              {formatEngagement(topic.avg_engagement_seconds)}
                            </span>
                            {topic.click_count !== null && (
                              <span>
                                点击 {formatMetric(topic.click_count)}
                              </span>
                            )}
                            {topic.read_count !== null && (
                              <span>阅读 {formatMetric(topic.read_count)}</span>
                            )}
                          </div>
                          {topic.first_image_url && (
                            <img
                              src={topic.first_image_url}
                              alt="WikiFX 文章首图"
                              width={320}
                              height={180}
                              loading="lazy"
                              className="max-h-44 w-auto rounded-md border border-border object-contain"
                            />
                          )}
                          {topic.url && (
                            <a
                              href={topic.url}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-primary hover:underline"
                            >
                              {topic.url}
                            </a>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
