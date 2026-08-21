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
