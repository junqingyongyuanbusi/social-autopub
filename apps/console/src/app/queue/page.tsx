import Link from "next/link";
import { fetchContents, ContentItem, ContentListParams } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  news: "新闻",
  education: "教育",
  review: "测评",
  exposure: "曝光",
};

const SOURCE_LABEL: Record<string, string> = {
  notion: "Notion",
  wikifx: "WikiFX 热点",
  http: "HTTP 推送",
};

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<ContentListParams>;
}) {
  const params = await searchParams;
  let items: ContentItem[] = [];
  let loadError = "";
  try {
    items = await fetchContents({
      status: params.status,
      language: params.language,
      contentType: params.contentType,
      source: params.source,
    });
  } catch (cause) {
    loadError = cause instanceof Error ? cause.message : "内容队列加载失败";
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">内容队列</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按状态、语言、内容类型和来源查看已进入发布流水线的内容。
        </p>
      </div>

      <form
        method="get"
        action="/queue"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">状态</span>
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">全部状态</option>
            <option value="PENDING">待生成</option>
            <option value="GENERATING">生成中</option>
            <option value="REVIEW">待审核</option>
            <option value="APPROVED">已通过</option>
            <option value="PUBLISHED">已发布</option>
            <option value="FAILED">失败</option>
            <option value="REJECTED">已驳回</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">语言</span>
          <input
            name="language"
            defaultValue={params.language ?? ""}
            placeholder="如 en"
            className="min-h-10 w-28 rounded-md border border-border px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            内容类型
          </span>
          <select
            name="contentType"
            defaultValue={params.contentType ?? ""}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">全部类型</option>
            <option value="news">新闻</option>
            <option value="education">教育</option>
            <option value="review">测评</option>
            <option value="exposure">曝光</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">来源</span>
          <select
            name="source"
            defaultValue={params.source ?? ""}
            className="min-h-10 rounded-md border border-border bg-card px-2.5 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">全部来源</option>
            <option value="notion">Notion</option>
            <option value="wikifx">WikiFX 热点</option>
            <option value="http">HTTP 推送</option>
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          应用筛选
        </button>
        <Link
          href="/queue"
          className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          清除
        </Link>
      </form>

      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          无法加载内容队列：{loadError}。
        </div>
      )}
      {!loadError && (items.length === 0
        ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            暂无内容。请在 Notion 表中勾选 `social_media_sent`，或通过 POST
            /v1/ingest 推送内容，任务会出现在这里。
          </div>
        )
        : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card" aria-label="内容队列表格">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium">语言</th>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 font-medium">来源</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium tabular-nums">
                    创建时间
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-border hover:bg-muted/30"
                  >
                    <td className="max-w-md px-4 py-2.5">
                      <Link
                        href={`/review/${item.id}`}
                        className="break-words hover:text-primary hover:underline"
                      >
                        {item.title}
                      </Link>
                      {item.lastError && (
                        <p className="mt-1 line-clamp-2 text-xs text-destructive">
                          {item.lastError}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 uppercase">{item.language}</td>
                    <td className="px-4 py-2.5">
                      {TYPE_LABEL[item.contentType] ?? item.contentType}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                        {SOURCE_LABEL[item.source] ?? item.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
