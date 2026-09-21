import assert from "node:assert/strict";
import test from "node:test";
import { PostizOutcomeUnknownError } from "../postiz/postiz.client";
import { PublishProcessor } from "./publish.processor";

test("publishes the composed body with localized CTA and .me URL", async () => {
  let postedContent = "";
  const contentItem = {
    id: "item-1",
    status: "PUBLISHING",
    publishRevision: 1,
    source: "notion",
    sourceTableType: "exposure-review",
    publishLink: "https://example.com/report",
    language: "en",
    contentType: "exposure",
    generations: [
      {
        platform: "x",
        content: "Summary",
        media: [],
        settings: null,
      },
    ],
  };
  const prisma = {
    publishJob: {
      findUnique: async () => ({ status: "queued" }),
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        id: "job-1",
        contentItemId: contentItem.id,
        publishRevision: 1,
        platform: "x",
        postizIntegrationId: "integration-1",
        scheduledAt: null,
        mediaSnapshot: [],
        contentItem,
      }),
      update: async () => ({}),
      findMany: async () => [{ status: "sent" }],
    },
    account: { findUnique: async () => null },
    contentItem: {
      updateMany: async () => ({ count: 1 }),
    },
  };
  const processor = new PublishProcessor(
    prisma as any,
    {
      acquireRequestBudget: async () => undefined,
      createPost: async ({ content }: { content: string }) => {
        postedContent = content;
        return { postId: "post-1" };
      },
    } as any,
  );

  await processor.process({
    data: { publishJobId: "job-1" },
    attemptsMade: 0,
    opts: { attempts: 2 },
  } as any);

  assert.equal(postedContent, "Summary\n\nFull Report: https://example.me/report");
});

test("unknown Postiz outcome is not automatically retried", async () => {
  let jobStatus = "";
  let contentStatus = "PUBLISHING";
  const contentItem = {
    id: "item-unknown",
    status: "PUBLISHING",
    publishRevision: 2,
    source: "http",
    sourceTableType: null,
    publishLink: null,
    language: "en",
    contentType: "news",
    generations: [
      { platform: "x", content: "Summary", media: [], settings: null },
    ],
  };
  const processor = new PublishProcessor(
    {
      publishJob: {
        findUnique: async () => ({ status: "queued" }),
        updateMany: async ({ data }: any) => {
          if (data.status) jobStatus = data.status;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({
          id: "job-unknown",
          contentItemId: contentItem.id,
          publishRevision: 2,
          platform: "x",
          postizIntegrationId: "integration-1",
          scheduledAt: null,
          mediaSnapshot: [],
          contentItem,
        }),
        update: async () => ({}),
        findMany: async () => [],
      },
      account: { findUnique: async () => null },
      contentItem: {
        updateMany: async ({ data }: any) => {
          if (data.status) contentStatus = data.status;
          return { count: 1 };
        },
      },
    } as any,
    {
      acquireRequestBudget: async () => undefined,
      createPost: async () => {
        throw new PostizOutcomeUnknownError("result unknown");
      },
    } as any,
  );

  await processor.process({
    data: { publishJobId: "job-unknown" },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any);

  assert.equal(jobStatus, "unknown");
  assert.equal(contentStatus, "PUBLISHING");
});

test("remote acceptance never escapes to Bull retry when local compensation also fails", async () => {
  let createCalls = 0;
  let claimCalls = 0;
  const contentItem = {
    id: "item-accepted",
    status: "PUBLISHING",
    publishRevision: 4,
    source: "http",
    sourceTableType: null,
    publishLink: null,
    language: "en",
    contentType: "news",
    generations: [
      { platform: "x", content: "Summary", media: [], settings: null },
    ],
  };
  const processor = new PublishProcessor(
    {
      publishJob: {
        findUnique: async () => ({ status: "queued" }),
        updateMany: async () => {
          claimCalls++;
          if (claimCalls === 1) return { count: 1 };
          if (claimCalls === 2 || claimCalls === 3) {
            throw new Error("database unavailable");
          }
          return { count: 0 };
        },
        findUniqueOrThrow: async () => ({
          id: "job-accepted",
          contentItemId: contentItem.id,
          publishRevision: 4,
          platform: "x",
          postizIntegrationId: "integration-1",
          scheduledAt: null,
          mediaSnapshot: [],
          contentItem,
        }),
        update: async () => {
          throw new Error("sent write failed");
        },
        findMany: async () => [],
      },
      account: { findUnique: async () => null },
      contentItem: { updateMany: async () => ({ count: 0 }) },
    } as any,
    {
      acquireRequestBudget: async () => undefined,
      createPost: async () => {
        createCalls++;
        return { postId: "post-accepted" };
      },
    } as any,
  );
  const job = {
    data: { publishJobId: "job-accepted" },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;

  await processor.process(job);
  await processor.process(job);

  assert.equal(createCalls, 1);
});

test("manual content whose generation only has prepared media still publishes", async () => {
  const prepared = [{ id: "media-1", path: "https://example.invalid/a.jpg" }];
  const contentItem = {
    id: "item-manual",
    status: "PUBLISHING",
    publishRevision: 1,
    source: "manual",
    sourceTableType: null,
    publishLink: null,
    language: "en",
    contentType: "manual",
    generations: [
      {
        platform: "instagram",
        content: "手动撰写文案",
        media: [],
        preparedMedia: prepared,
        settings: null,
      },
    ],
  };
  let postedMedia: unknown = null;
  const processor = new PublishProcessor(
    {
      publishJob: {
        findUnique: async () => ({ status: "queued" }),
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          id: "job-manual",
          contentItemId: contentItem.id,
          publishRevision: 1,
          platform: "instagram",
          postizIntegrationId: "integration-1",
          scheduledAt: null,
          mediaSnapshot: prepared,
          contentItem,
        }),
        update: async () => ({}),
        findMany: async () => [{ status: "sent" }],
      },
      account: { findUnique: async () => null },
      contentItem: { updateMany: async () => ({ count: 1 }) },
    } as any,
    {
      acquireRequestBudget: async () => undefined,
      createPost: async (input: { preparedMedia?: unknown }) => {
        postedMedia = input.preparedMedia;
        return { postId: "post-manual" };
      },
    } as any,
  );

  await processor.process({
    data: { publishJobId: "job-manual" },
    attemptsMade: 0,
    opts: { attempts: 2 },
  } as any);

  assert.deepEqual(postedMedia, prepared);
});

test("manual content without a stored snapshot is still rejected before Postiz", async () => {
  const contentItem = {
    id: "item-manual-nosnap",
    status: "PUBLISHING",
    publishRevision: 1,
    source: "manual",
    sourceTableType: null,
    publishLink: null,
    language: "en",
    contentType: "manual",
    generations: [
      {
        platform: "instagram",
        content: "手动撰写文案",
        media: [],
        preparedMedia: [{ id: "media-1", path: "https://example.invalid/a.jpg" }],
        settings: null,
      },
    ],
  };
  let createCalls = 0;
  const processor = new PublishProcessor(
    {
      publishJob: {
        findUnique: async () => ({ status: "queued" }),
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          id: "job-manual-nosnap",
          contentItemId: contentItem.id,
          publishRevision: 1,
          platform: "instagram",
          postizIntegrationId: "integration-1",
          scheduledAt: null,
          mediaSnapshot: null,
          contentItem,
        }),
        update: async () => ({}),
        findMany: async () => [{ status: "failed" }],
      },
      account: { findUnique: async () => null },
      contentItem: { updateMany: async () => ({ count: 1 }) },
    } as any,
    {
      acquireRequestBudget: async () => undefined,
      createPost: async () => {
        createCalls++;
        return { postId: "should-not-happen" };
      },
    } as any,
  );

  await processor.process({
    data: { publishJobId: "job-manual-nosnap" },
    attemptsMade: 0,
    opts: { attempts: 2 },
  } as any);

  assert.equal(createCalls, 0);
});
