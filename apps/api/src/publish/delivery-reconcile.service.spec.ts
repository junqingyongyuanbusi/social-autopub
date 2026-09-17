import assert from "node:assert/strict";
import test from "node:test";
import { PostizDeliveryReconcileService } from "./delivery-reconcile.service";

const originalPostizUrl = process.env.POSTIZ_API_URL;

function restorePostizUrl() {
  if (originalPostizUrl === undefined) delete process.env.POSTIZ_API_URL;
  else process.env.POSTIZ_API_URL = originalPostizUrl;
}

function buildService(options: {
  jobs: Array<{ id: string; postizPostId: string | null; contentItemId: string }>;
  posts: Array<{ id: string; state?: string }>;
}) {
  const jobUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const contentUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let listPostsCalls = 0;
  const service = new PostizDeliveryReconcileService(
    {
      publishJob: {
        findMany: async () => options.jobs,
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          jobUpdates.push(args);
          return { count: 1 };
        },
      },
      contentItem: {
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          contentUpdates.push(args);
          return { count: 1 };
        },
      },
    } as any,
    {
      listPosts: async () => {
        listPostsCalls += 1;
        return options.posts;
      },
    } as any,
  );
  return {
    service,
    jobUpdates,
    contentUpdates,
    listPostsCalls: () => listPostsCalls,
  };
}

test("reconcile rolls a failed Postiz delivery back to a retryable state", async () => {
  process.env.POSTIZ_API_URL = "https://postiz.invalid";
  try {
    const { service, jobUpdates, contentUpdates } = buildService({
      jobs: [{ id: "job-1", postizPostId: "post-1", contentItemId: "item-1" }],
      posts: [{ id: "post-1", state: "ERROR" }],
    });

    await service.reconcile();

    assert.deepEqual(jobUpdates, [
      {
        where: { id: "job-1", status: "sent" },
        data: {
          status: "failed",
          error: "Postiz 投递失败（state=ERROR），可在发布记录页重试",
        },
      },
    ]);
    assert.deepEqual(contentUpdates, [
      {
        where: { id: "item-1", status: "PUBLISHED" },
        data: {
          status: "FAILED",
          lastError: "存在投递失败的平台，可在发布记录页重试",
        },
      },
    ]);
  } finally {
    restorePostizUrl();
  }
});

test("reconcile keeps delivered posts untouched", async () => {
  process.env.POSTIZ_API_URL = "https://postiz.invalid";
  try {
    const { service, jobUpdates, contentUpdates } = buildService({
      jobs: [{ id: "job-1", postizPostId: "post-1", contentItemId: "item-1" }],
      posts: [{ id: "post-1", state: "PUBLISHED" }],
    });

    await service.reconcile();

    assert.equal(jobUpdates.length, 0);
    assert.equal(contentUpdates.length, 0);
  } finally {
    restorePostizUrl();
  }
});

test("reconcile skips Postiz entirely when nothing was sent recently", async () => {
  process.env.POSTIZ_API_URL = "https://postiz.invalid";
  try {
    const { service, listPostsCalls } = buildService({ jobs: [], posts: [] });

    await service.reconcile();

    assert.equal(listPostsCalls(), 0);
  } finally {
    restorePostizUrl();
  }
});
