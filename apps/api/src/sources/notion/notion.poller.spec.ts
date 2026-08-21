import assert from "node:assert/strict";
import test from "node:test";
import { NotionPoller } from "./notion.poller";

test("an expired poller cannot release a newer instance lock", async () => {
  let storedToken: string | null = "new-token";
  const redis = {
    eval: async (script: string, _keys: number, _key: string, token: string) => {
      if (storedToken !== token) return 0;
      if (script.includes("del")) storedToken = null;
      return 1;
    },
  };
  const poller = new NotionPoller({} as any, {} as any, {} as any, redis as any);

  assert.equal(await (poller as any).extendLock("old-token"), false);
  await (poller as any).releaseLock("old-token");
  assert.equal(storedToken, "new-token");
  await (poller as any).releaseLock("new-token");
  assert.equal(storedToken, null);
});

test("backfill skips the latest published version instead of falling back to an older draft", async () => {
  let updated = false;
  let requeued = false;
  const redis = {
    set: async () => "OK",
    eval: async () => 1,
  };
  const prisma = {
    sourceDatabase: {
      findMany: async () => [
        { notionDatabaseId: "db-1", language: "en", tableType: "exposure-review" },
      ],
    },
    contentItem: {
      findFirst: async () => ({
        id: "latest",
        status: "PUBLISHED",
        _count: { jobs: 1 },
      }),
      updateMany: async () => {
        updated = true;
        return { count: 1 };
      },
    },
  };
  const poller = new NotionPoller(
    prisma as any,
    {
      queryAllReadyPages: async () => [{ id: "page-1", properties: {} }],
      toPayload: async () => ({
        payload: {
          external_id: "page-1",
          language: "en",
          content_type: "review",
          title: "Title",
          body: "Body",
          media: [],
          target_platforms: [],
          source_table_type: "exposure-review",
          publish_link: "https://example.com/report",
        },
        rawPayload: { mediaRefs: [] },
        mediaRefs: [],
      }),
    } as any,
    {
      findPreferredNotionEquivalent: async () => ({
        id: "latest",
        status: "PUBLISHED",
        jobs: [{ id: "job-1", status: "sent" }],
      }),
      requeueForMetadataRefresh: async () => {
        requeued = true;
      },
    } as any,
    redis as any,
  );
  const previous = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = "test";
  try {
    const report = await poller.backfillExposureReviewLinks();
    assert.equal(report.skipped, 1);
  } finally {
    if (previous === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previous;
  }
  assert.equal(updated, false);
  assert.equal(requeued, false);
});

test("backfill CAS does not overwrite a record claimed after lookup", async () => {
  let requeued = false;
  let receivedMetadata: Record<string, unknown> | null = null
  const poller = new NotionPoller(
    {
      sourceDatabase: {
        findMany: async () => [
          { notionDatabaseId: "db-1", language: "en", tableType: "exposure-review" },
        ],
      },
      contentItem: {
        findFirst: async () => ({ id: "item-1", status: "REVIEW", _count: { jobs: 0 } }),
        updateMany: async () => ({ count: 0 }),
      },
    } as any,
    {
      queryAllReadyPages: async () => [{ id: "page-1", properties: {} }],
      toPayload: async () => ({
        payload: {
          external_id: "page-1",
          language: "en",
          content_type: "review",
          title: "Title",
          body: "Body",
          media: [],
          target_platforms: [],
          source_table_type: "exposure-review",
          publish_link: "https://example.com/report",
        },
        rawPayload: { mediaRefs: [] },
        mediaRefs: [],
      }),
    } as any,
    {
      findPreferredNotionEquivalent: async () => ({
        id: "item-1",
        status: "REVIEW",
        jobs: [],
        language: "en",
        contentType: "review",
        sourceTableType: "exposure-review",
        publishLink: null,
        lastError: null,
        forceReview: false,
      }),
      requeueForMetadataRefresh: async (
        _id: string,
        metadata: Record<string, unknown>,
      ) => {
        requeued = true;
        receivedMetadata = metadata;
        return false;
      },
    } as any,
    { set: async () => "OK", eval: async () => 1 } as any,
  );
  const previous = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = "test";
  try {
    const report = await poller.backfillExposureReviewLinks();
    assert.equal(report.skipped, 1);
  } finally {
    if (previous === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previous;
  }
  assert.equal(requeued, true);
  assert.equal((receivedMetadata as Record<string, unknown> | null)?.contentType, "review");
});

test("lost lock prevents advancing the Notion polling watermark", async () => {
  let advanced = false;
  const poller = new NotionPoller(
    {
      sourceDatabase: {
        update: async () => {
          advanced = true;
        },
      },
    } as any,
    { queryReadyPages: async () => [] } as any,
    {} as any,
    {} as any,
  );
  (poller as any).lockLost = true;
  await assert.rejects(
    () =>
      (poller as any).pollOne({
        id: "source-1",
        notionDatabaseId: "db-1",
        language: "en",
        tableType: "exposure-review",
        lastPolledAt: null,
      }),
    /锁已丢失/,
  );
  assert.equal(advanced, false);
});

test("token mismatch stops polling before content mutation", async () => {
  let ingested = false;
  let advanced = false;
  const poller = new NotionPoller(
    {
      sourceDatabase: { update: async () => { advanced = true; } },
    } as any,
    {
      queryReadyPages: async () => [{ id: "page-1", properties: {} }],
      toPayload: async () => ({ external_id: "page-1" }),
    } as any,
    { upsert: async () => { ingested = true; } } as any,
    { eval: async () => 0 } as any,
  );

  await assert.rejects(
    () =>
      (poller as any).pollOne(
        {
          id: "source-1",
          notionDatabaseId: "db-1",
          language: "en",
          tableType: "exposure-review",
          lastPolledAt: null,
        },
        "old-token",
      ),
    /锁已丢失/,
  );
  assert.equal(ingested, false);
  assert.equal(advanced, false);
});

test("backfill token replacement stops before metadata mutation", async () => {
  let expireChecks = 0;
  let mutated = false;
  const poller = new NotionPoller(
    {
      sourceDatabase: {
        findMany: async () => [
          { notionDatabaseId: "db-1", language: "en", tableType: "exposure-review" },
        ],
      },
      contentItem: {
        findFirst: async () => ({ id: "item-1", status: "REVIEW", _count: { jobs: 0 } }),
      },
    } as any,
    {
      queryAllReadyPages: async () => [{ id: "page-1", properties: {} }],
      toPayload: async () => ({
        payload: {
          external_id: "page-1",
          language: "en",
          content_type: "review",
          title: "Title",
          body: "Body",
          media: [],
          target_platforms: [],
          source_table_type: "exposure-review",
          publish_link: "https://example.com/report",
        },
        rawPayload: { mediaRefs: [] },
        mediaRefs: [],
      }),
    } as any,
    {
      findPreferredNotionEquivalent: async () => ({
        id: "item-1",
        status: "REVIEW",
        jobs: [],
        language: "en",
        contentType: "review",
        sourceTableType: "exposure-review",
        publishLink: null,
        lastError: null,
        forceReview: false,
      }),
      requeueForMetadataRefresh: async () => {
        mutated = true;
        return true;
      },
    } as any,
    {
      set: async () => "OK",
      eval: async (script: string) => {
        if (script.includes("expire")) {
          expireChecks++;
          return expireChecks === 1 ? 1 : 0;
        }
        return 1;
      },
    } as any,
  );
  const previous = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = "test";
  try {
    await assert.rejects(() => poller.backfillExposureReviewLinks(), /锁已丢失/);
  } finally {
    if (previous === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previous;
  }
  assert.equal(mutated, false);
});

test("backfill resumes an unchanged pending force-review item", async () => {
  let ensured = false;
  const poller = new NotionPoller(
    {
      sourceDatabase: {
        findMany: async () => [
          { notionDatabaseId: "db-1", language: "en", tableType: "exposure-review" },
        ],
      },
      contentItem: {
        findFirst: async () => ({
          id: "item-1",
          status: "PENDING",
          language: "en",
          contentType: "review",
          sourceTableType: "exposure-review",
          publishLink: "https://example.com/report",
          lastError: null,
          forceReview: true,
          generationRevision: 7,
          _count: { jobs: 0 },
        }),
      },
    } as any,
    {
      queryAllReadyPages: async () => [{ id: "page-1", properties: {} }],
      toPayload: async () => ({
        payload: {
          external_id: "page-1",
          language: "en",
          content_type: "review",
          title: "Title",
          body: "Body",
          media: [],
          target_platforms: [],
          source_table_type: "exposure-review",
          publish_link: "https://example.com/report",
        },
        rawPayload: { mediaRefs: [] },
        mediaRefs: [],
      }),
    } as any,
    {
      findPreferredNotionEquivalent: async () => ({
        id: "item-1",
        status: "PENDING",
        jobs: [],
        language: "en",
        contentType: "review",
        sourceTableType: "exposure-review",
        publishLink: "https://example.com/report",
        lastError: null,
        mediaFingerprint: '[]',
        forceReview: true,
      }),
      ensurePendingGenerationJob: async (_id: string, forceReview: boolean) => {
        ensured = forceReview;
        return true;
      },
    } as any,
    { set: async () => "OK", eval: async () => 1 } as any,
  );
  const previous = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = "test";
  try {
    const report = await poller.backfillExposureReviewLinks();
    assert.equal(report.pendingRequeued, 1);
    assert.equal(report.requeued, 1);
  } finally {
    if (previous === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previous;
  }
  assert.equal(ensured, true);
});

test("a failed page is isolated while successful pages advance the watermark", async () => {
  const failures: string[] = [];
  const deleted: string[] = [];
  const ingested: string[] = [];
  let advanced = false;
  const poller = new NotionPoller(
    {
      notionIngestFailure: {
        findMany: async () => [],
        upsert: async ({ create }: any) => {
          failures.push(create.pageId);
          return create;
        },
        deleteMany: async ({ where }: any) => {
          deleted.push(where.pageId);
          return { count: 1 };
        },
      },
      sourceDatabase: {
        update: async () => {
          advanced = true;
        },
      },
    } as any,
    {
      queryReadyPages: async () => [
        { id: "bad", properties: {} },
        { id: "good", properties: {} },
      ],
      toPayload: async (page: { id: string }) => {
        if (page.id === "bad") throw new Error("image download failed");
        return {
          payload: {
            external_id: page.id,
            language: "en",
            content_type: "news",
            title: "Title",
            body: "Body",
            media: [],
            target_platforms: [],
          },
          rawPayload: { mediaRefs: [] },
          mediaRefs: [],
        };
      },
    } as any,
    {
      upsert: async (_source: string, payload: { external_id: string }) => {
        ingested.push(payload.external_id);
      },
    } as any,
    { eval: async () => 1 } as any,
  );
  (poller as any).activeLockToken = "lock-token";

  const count = await (poller as any).pollOne(
    {
      id: "source-1",
      notionDatabaseId: "db-1",
      language: "en",
      tableType: "news",
      lastPolledAt: null,
    },
    "lock-token",
  );

  assert.equal(count, 1);
  assert.deepEqual(failures, ["bad"]);
  assert.deepEqual(ingested, ["good"]);
  assert.deepEqual(deleted, ["good"]);
  assert.equal(advanced, true);
});
