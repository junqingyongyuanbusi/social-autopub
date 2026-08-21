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
