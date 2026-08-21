import { fetchWikiFxTopics } from "@/lib/api";
import { TopicsConsole } from "./topics-console";

export const dynamic = "force-dynamic";

function parseDays(value: string | undefined) {
  return value === "1" || value === "2" || value === "3" ? Number(value) : 3;
}

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = parseDays(params.days);
  let data = null;
  let error = "";
  try {
    data = await fetchWikiFxTopics({ days, top: 1 });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "热点数据加载失败";
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">热点选题</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          查看 WikiFX
          热点文章的自然日统计，筛选值得进入内容队列的选题。列表保持上游排序，采用后会进入现有审核流程。
        </p>
      </div>

      {!data
        ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            无法加载热点数据：{error || "请确认 API 服务状态后刷新"}。
          </div>
        )
        : <TopicsConsole initialData={data} />}
    </div>
  );
}
