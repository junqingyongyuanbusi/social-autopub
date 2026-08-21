import assert from "node:assert/strict";
import test from "node:test";
import { IngestService } from "./ingest.service";

test("metadata refresh requeues with a new BullMQ job id", async () => {
  const jobIds: string[] = [];
  const forceReviewFlags: boolean[] = []
  const prisma = {
    contentItem: {
      findUnique: async () => ({
        status: "FAILED",
        generationRevision: 2,
        _count: { jobs: 0 },
      })
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        contentItem: {
          updateMany: async () => ({ count: 1 }),
          findUniqueOrThrow: async () => ({ generationRevision: 3 }),
        },
        generation: { deleteMany: async () => ({ count: 1 }) },
      })
  };
  const service = new IngestService(
    prisma as any,
    {
      add: async (
        _name: string,
        data: { forceReview?: boolean },
        options: { jobId: string },
      ) => {
        jobIds.push(options.jobId);
        forceReviewFlags.push(data.forceReview ?? false)
      },
    } as any,
  );

  assert.equal(await service.requeueForMetadataRefresh("item-1"), true);
  assert.equal(jobIds.length, 1);
  assert.equal(jobIds[0], "generation-item-1-r3");
  assert.notEqual(jobIds[0], "generation-item-1-r2");
  assert.deepEqual(forceReviewFlags, [true])
});

test("metadata refresh excludes active generation and any publish history", async () => {
  for (const item of [
    { status: "GENERATING", generationRevision: 1, _count: { jobs: 0 } },
    { status: "FAILED", generationRevision: 1, _count: { jobs: 1 } }
  ]) {
    let enqueued = false;
    const service = new IngestService(
      {
        contentItem: { findUnique: async () => item },
      } as any,
      { add: async () => { enqueued = true; } } as any,
    );
    assert.equal(await service.requeueForMetadataRefresh("item-1"), false);
    assert.equal(enqueued, false);
  }
});

test("pending metadata refresh increments revision and invalidates older jobs", async () => {
  const jobIds: string[] = [];
  let revision = 4;
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => ({
          status: "PENDING",
          generationRevision: revision,
          _count: { jobs: 0 },
        }),
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            updateMany: async () => {
              revision++;
              return { count: 1 };
            },
            findUniqueOrThrow: async () => ({ generationRevision: revision }),
          },
          generation: { deleteMany: async () => ({ count: 1 }) },
        }),
    } as any,
    {
      add: async (_name: string, _data: unknown, options: { jobId: string }) => {
        jobIds.push(options.jobId);
      },
    } as any,
  );

  await service.requeueForMetadataRefresh("item-1");
  await service.requeueForMetadataRefresh("item-1");
  assert.deepEqual(jobIds, ["generation-item-1-r5", "generation-item-1-r6"]);
  assert.equal(jobIds.includes("generation-item-1-r4"), false);
});

test("non exposure-review metadata does not reset an existing review draft", async () => {
  let updated = false;
  let enqueued = false;
  const existing = {
    id: "item-news",
    status: "REVIEW",
    jobs: [],
    sourceTableType: null,
    publishLink: null,
    contentType: "news",
    language: "en",
    generationRevision: 0,
  };
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => existing,
        updateMany: async () => {
          updated = true;
          return { count: 1 };
        },
      },
    } as any,
    { add: async () => { enqueued = true; } } as any,
  );

  const result = await service.upsert("notion", {
    external_id: "page-news",
    language: "en",
    content_type: "news",
    title: "Title",
    body: "Body",
    media: [],
    target_platforms: [],
    source_table_type: "news-edu",
  });
  assert.equal(result.id, existing.id);
  assert.equal(updated, false);
  assert.equal(enqueued, false);
});

test("invalid link metadata atomically invalidates stale generations", async () => {
  let deleted = false;
  let updateData: Record<string, unknown> = {};
  const service = new IngestService(
    {
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
              updateData = data;
              return { count: 1 };
            },
          },
          generation: {
            deleteMany: async () => {
              deleted = true;
              return { count: 1 };
            },
          },
        }),
    } as any,
    {} as any,
  );

  assert.equal(
    await service.failForInvalidMetadata(
      "item-1",
      { publishLink: "bad-url", sourceTableType: "exposure-review" },
      "invalid link",
    ),
    true,
  );
  assert.equal(updateData.status, "FAILED");
  assert.equal(updateData.forceReview, true);
  assert.deepEqual(updateData.generationRevision, { increment: 1 });
  assert.equal(deleted, true);
});

test("first invalid exposure-review item is stored FAILED without enqueue", async () => {
  let createdData: Record<string, unknown> = {};
  let enqueued = false;
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return {
            ...data,
            id: "item-invalid",
            status: data.status,
            generationRevision: 0,
          };
        },
      },
    } as any,
    { add: async () => { enqueued = true; } } as any,
  );

  const result = await service.upsert("notion", {
    external_id: "page-invalid",
    language: "en",
    content_type: "review",
    title: "Title",
    body: "Body",
    media: [],
    target_platforms: [],
    source_table_type: "exposure-review",
    publish_link: "not-a-url",
  });
  assert.equal(result.status, "FAILED");
  assert.match(String(createdData.lastError), /格式无效/);
  assert.equal(createdData.forceReview, true);
  assert.equal(enqueued, false);
});

test("pending force-review job can be retried after enqueue failure", async () => {
  const attempts: Array<{ jobId: string; forceReview?: boolean }> = [];
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => ({
          status: "PENDING",
          generationRevision: 7,
          forceReview: true,
          _count: { jobs: 0 },
        }),
      },
    } as any,
    {
      add: async (
        _name: string,
        data: { forceReview?: boolean },
        options: { jobId: string },
      ) => {
        attempts.push({ jobId: options.jobId, forceReview: data.forceReview });
        if (attempts.length === 1) throw new Error("redis unavailable");
      },
    } as any,
  );

  await assert.rejects(() => service.ensurePendingGenerationJob("item-1", true));
  assert.equal(await service.ensurePendingGenerationJob("item-1", true), true);
  assert.deepEqual(attempts, [
    { jobId: "generation-item-1-r7", forceReview: true },
    { jobId: "generation-item-1-r7", forceReview: true },
  ]);
});

const notionPayload = (media: string[]) => ({
  external_id: "page-media",
  language: "en",
  content_type: "news" as const,
  title: "Title",
  body: "Body",
  media,
  target_platforms: [] as Array<"x" | "instagram" | "facebook">,
});

test("same Notion image bytes with rotated signed URLs reuse one content item", async () => {
  let stored: any = null;
  let creates = 0;
  const queuedJobIds: string[] = [];
  const prisma = {
    contentItem: {
      findUnique: async ({ where }: any) =>
        stored?.contentHash === where.source_externalId_contentHash.contentHash
          ? stored
          : null,
      findMany: async () => (stored ? [stored] : []),
      updateMany: async ({ data }: any) => {
        if (stored && data.rawPayload) stored.rawPayload = data.rawPayload;
        return { count: 0 };
      },
      create: async ({ data }: any) => {
        creates++;
        stored = {
          ...data,
          id: "item-media",
          generationRevision: 0,
          jobs: [],
          createdAt: new Date(),
        };
        return stored;
      },
    },
  };
  const service = new IngestService(
    prisma as any,
    {
      add: async (_name: string, _data: unknown, options: { jobId: string }) => {
        queuedJobIds.push(options.jobId);
      },
    } as any,
  );
  const firstMedia = {
    kind: "notion-hosted" as const,
    url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/file.png?sig=one",
    blockId: "block-1",
    contentDigest: "same-bytes",
    fingerprintKey: "notion-hosted:sha256:same-bytes",
  };
  const secondMedia = {
    ...firstMedia,
    url: "https://another-cdn.example/file.png?sig=two",
    blockId: "block-2",
  };

  await service.upsert("notion", notionPayload([firstMedia.url]), {
    sourceMedia: [firstMedia],
    rawPayload: { mediaRefs: [firstMedia] },
  });
  stored.status = "PUBLISHED";
  stored.jobs = [{ id: "published-job", status: "sent" }];
  await service.upsert("notion", notionPayload([secondMedia.url]), {
    sourceMedia: [secondMedia],
    rawPayload: { mediaRefs: [secondMedia] },
  });

  assert.equal(creates, 1);
  assert.deepEqual(queuedJobIds, ["generation-item-media-r0"]);
});

test("uncertain legacy hosted-media cutover creates a force-review version", async () => {
  let createdData: any = null;
  let enqueued = 0;
  const legacy = {
    id: "legacy-published",
    source: "notion",
    externalId: "page-media",
    contentHash: "legacy-hash",
    mediaFingerprint: null,
    title: "Title",
    body: "Body",
    media: ["https://prod-files-secure.s3.us-west-2.amazonaws.com/file.png?sig=old"],
    rawPayload: {},
    status: "PUBLISHED",
    jobs: [{ id: "job-old", status: "sent" }],
    createdAt: new Date(),
    sourceTableType: null,
    publishLink: null,
    contentType: "news",
    language: "en",
    generationRevision: 0,
    forceReview: false,
    lastError: null,
  };
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => null,
        findMany: async () => [legacy],
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          createdData = data;
          return { ...data, id: "review-version", generationRevision: 0 };
        },
      },
    } as any,
    { add: async () => { enqueued++; } } as any,
  );
  const incoming = {
    kind: "notion-hosted" as const,
    url: "https://new-host.example/new-path.png?sig=new",
    blockId: "block-current",
    contentDigest: "current-bytes",
    fingerprintKey: "notion-hosted:sha256:current-bytes",
  };

  await service.upsert("notion", notionPayload([incoming.url]), {
    sourceMedia: [incoming],
    rawPayload: { mediaRefs: [incoming] },
  });

  assert.equal(createdData.forceReview, true);
  assert.equal(createdData.mediaFingerprint, '[["notion-hosted","notion-hosted:sha256:current-bytes"]]');
  assert.equal(enqueued, 1);
});

test("real media change after a published stable version remains review-gated", async () => {
  let createdData: any = null;
  const published = {
    id: "stable-published",
    source: "notion",
    externalId: "page-media",
    contentHash: "stable-old",
    mediaFingerprint: '[["notion-hosted","notion-hosted:sha256:old"]]',
    title: "Title",
    body: "Body",
    media: ["https://notion.example/old"],
    rawPayload: {
      mediaRefs: [
        {
          kind: "notion-hosted",
          url: "https://notion.example/old",
          fingerprintKey: "notion-hosted:sha256:old",
        },
      ],
    },
    status: "PUBLISHED",
    jobs: [{ id: "job-old", status: "sent" }],
    createdAt: new Date(),
    sourceTableType: null,
    publishLink: null,
    contentType: "news",
    language: "en",
    generationRevision: 0,
    forceReview: false,
    lastError: null,
  };
  const service = new IngestService(
    {
      contentItem: {
        findUnique: async () => null,
        findMany: async () => [published],
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          createdData = data;
          return { ...data, id: "changed-review", generationRevision: 0 };
        },
      },
    } as any,
    { add: async () => undefined } as any,
  );
  const changed = {
    kind: "notion-hosted" as const,
    url: "https://notion.example/new",
    blockId: "block-new",
    contentDigest: "new",
    fingerprintKey: "notion-hosted:sha256:new",
  };

  await service.upsert("notion", notionPayload([changed.url]), {
    sourceMedia: [changed],
    rawPayload: { mediaRefs: [changed] },
  });

  assert.equal(createdData.forceReview, true);
});
