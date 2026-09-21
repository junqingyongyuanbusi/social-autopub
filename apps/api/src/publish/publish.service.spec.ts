import assert from "node:assert/strict";
import test from "node:test";
import { PublishService } from "./publish.service";

test("dispatch claims a revision and queues one deterministic preparation job", async () => {
  const queued: Array<{
    name: string;
    data: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const service = new PublishService(
    {
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            updateMany: async () => ({ count: 1 }),
            findUniqueOrThrow: async () => ({ publishRevision: 3 }),
          },
          publishJob: { updateMany: async () => ({ count: 2 }) },
        }),
      contentItem: {
        findUniqueOrThrow: async () => ({ status: "APPROVED" }),
        updateMany: async () => ({ count: 1 }),
      },
      publishJob: { count: async () => 0 },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      add: async (
        name: string,
        data: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        queued.push({ name, data, options });
      },
    } as any,
    {} as any,
  );

  assert.equal(
    await service.dispatch("item-1", [
      { platform: "x", postizIntegrationId: "integration-1" },
    ]),
    1,
  );
  assert.deepEqual(queued, [
    {
      name: "prepare-publish",
      data: { contentItemId: "item-1", publishRevision: 3 },
      options: {
        jobId: "prepare-item-1-r3",
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
      },
    },
  ]);
});

test("prepare reuses generation preparedMedia and skips secondary postiz preparation", async () => {
  const storedPrepared = [{ id: "postiz-media-1", path: "https://postiz.invalid/m1.jpg" }];
  const contentItem = {
    id: "item-manual",
    status: "PUBLISHING",
    publishRevision: 1,
    source: "manual",
    sourceTableType: null,
    publishLink: null,
    language: "en",
    contentType: "manual",
    publishAt: null,
    publishTargets: [{ platform: "instagram", postizIntegrationId: "ig-acc-1" }],
    generations: [
      {
        platform: "instagram",
        content: "manual copy",
        media: [],
        preparedMedia: storedPrepared,
      },
    ],
  };
  let prepareMediaCalled = false;
  let createdJobPayload: any = null;
  const enqueuedJobs: string[] = [];

  const service = new PublishService(
    {
      account: { findMany: async () => [] },
      contentItem: {
        findUniqueOrThrow: async () => contentItem,
        update: async () => ({}),
      },
      publishJob: {
        findMany: async () => [],
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          publishJob: {
            create: async ({ data }: any) => {
              createdJobPayload = data;
              return { id: "pjob-1", publishRevision: 1, status: "queued", ...data };
            },
          },
        }),
    } as any,
    {} as any,
    {
      prepareMedia: async () => {
        prepareMediaCalled = true;
        return [];
      },
    } as any,
    {} as any,
    {} as any,
    {
      add: async (_name: string, data: any) => {
        enqueuedJobs.push(data.publishJobId);
      },
    } as any,
  );

  const dispatched = await service.prepare("item-manual", 1);

  assert.equal(dispatched, 1);
  assert.equal(prepareMediaCalled, false);
  assert.deepEqual(createdJobPayload.mediaSnapshot, storedPrepared);
  assert.deepEqual(enqueuedJobs, ["pjob-1"]);
});
