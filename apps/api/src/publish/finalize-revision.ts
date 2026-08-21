import { Prisma, PrismaClient } from "@prisma/client";

export type PublishRevisionOutcome = "PUBLISHED" | "FAILED";

export interface PublishRevisionConclusion {
  // null = 仍有在途子任务或该 revision 没有任务，未到收敛时机
  outcome: PublishRevisionOutcome | null;
  // 内容行的守卫更新是否命中（false = 内容已不在该 revision 的 PUBLISHING）
  applied: boolean;
}

// 发布批次终局收敛的唯一实现：批次内子任务全部离开在途状态后，
// 全 sent → PUBLISHED（清空 lastError），否则 → FAILED（保留 lastError 供排查）。
// publish.processor 正常收尾、recovery 补偿收敛、jobs resolve-unknown 人工对账共用此处，
// 防止三份守卫条件各自漂移后悄悄破坏发布幂等。
export async function concludePublishRevision(
  db: PrismaClient | Prisma.TransactionClient,
  contentItemId: string,
  publishRevision: number,
): Promise<PublishRevisionConclusion> {
  const jobs = await db.publishJob.findMany({
    where: { contentItemId, publishRevision },
    select: { status: true },
  });
  const inFlight = jobs.some((job) =>
    ["queued", "publishing", "unknown"].includes(job.status),
  );
  if (!jobs.length || inFlight) return { outcome: null, applied: false };

  const outcome: PublishRevisionOutcome = jobs.every(
    (job) => job.status === "sent",
  )
    ? "PUBLISHED"
    : "FAILED";
  const updated = await db.contentItem.updateMany({
    where: { id: contentItemId, status: "PUBLISHING", publishRevision },
    data:
      outcome === "PUBLISHED"
        ? { status: "PUBLISHED", lastError: null }
        : { status: "FAILED" },
  });
  return { outcome, applied: updated.count > 0 };
}
