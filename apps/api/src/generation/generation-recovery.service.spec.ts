import assert from "node:assert/strict";
import test from "node:test";
import { GenerationRecoveryService } from "./generation-recovery.service";

function transactionMock(
  nextRevision: number,
  capture: {
    where?: any;
    data?: any;
    deleted?: any;
  },
) {
  return async (callback: (tx: any) => Promise<unknown>) =>
    callback({
      contentItem: {
        updateMany: async ({ where, data }: any) => {
          capture.where = where;
          capture.data = data;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ generationRevision: nextRevision }),
      },
      generation: {
        deleteMany: async ({ where }: any) => {
          capture.deleted = where;
          return { count: 1 };
        },
      },
    });
}

test("recovers stale GENERATING with terminal legacy job using a new revision", async () => {
  let findManyCall = 0;
  const capture: any = {};
  const added: Array<{ data: any; options: any }> = [];
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0 ? [{ id: "item-1", generationRevision: 0 }] : [],
      },
      $transaction: transactionMock(1, capture),
    } as any,
    {
      getJob: async (id: string) =>
        id.endsWith("-r0") ? null : { getState: async () => "completed" },
      add: async (_name: string, data: any, options: any) => {
        added.push({ data, options });
      },
    } as any,
  );

  assert.equal(await service.reconcile(), 1);
  assert.equal(capture.where.status, "GENERATING");
  assert.equal(capture.where.generationRevision, 0);
  assert.deepEqual(capture.where.jobs, { none: {} });
  assert.equal(capture.data.forceReview, true);
  assert.deepEqual(capture.data.generationRevision, { increment: 1 });
  assert.deepEqual(capture.deleted, { contentItemId: "item-1" });
  assert.deepEqual(added, [
    {
      data: { contentItemId: "item-1", forceReview: true, generationRevision: 1 },
      options: {
        jobId: "generation-item-1-r1",
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    },
  ]);
});

test("does not recover while the current revision job is active", async () => {
  let findManyCall = 0;
  let transacted = false;
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0 ? [{ id: "item-1", generationRevision: 1 }] : [],
      },
      $transaction: async () => {
        transacted = true;
      },
    } as any,
    { getJob: async () => ({ getState: async () => "active" }) } as any,
  );

  assert.equal(await service.reconcile(), 0);
  assert.equal(transacted, false);
});

test("waits for an older revision handler that is still active", async () => {
  let findManyCall = 0;
  let transacted = false;
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0 ? [{ id: "item-1", generationRevision: 1 }] : [],
      },
      $transaction: async () => {
        transacted = true;
      },
    } as any,
    {
      getJob: async (id: string) =>
        id.endsWith("-r0") ? { getState: async () => "active" } : null,
    } as any,
  );

  assert.equal(await service.reconcile(), 0);
  assert.equal(transacted, false);
});

test("requeues stale PENDING force-review item when current job is missing", async () => {
  let findManyCall = 0;
  const added: any[] = [];
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0
            ? []
            : [{ id: "item-1", generationRevision: 2, forceReview: true }],
        updateMany: async () => ({ count: 1 }),
      },
    } as any,
    {
      getJob: async () => null,
      add: async (_name: string, data: any, options: any) => {
        added.push({ data, options });
      },
    } as any,
  );

  assert.equal(await service.reconcile(), 1);
  assert.equal(added[0].options.jobId, "generation-item-1-r2");
  assert.equal(added[0].data.forceReview, true);
});

test("increments revision when stale PENDING points at retained terminal job", async () => {
  let findManyCall = 0;
  const capture: any = {};
  const added: any[] = [];
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0
            ? []
            : [{ id: "item-1", generationRevision: 2, forceReview: false }],
        updateMany: async () => ({ count: 1 }),
      },
      $transaction: transactionMock(3, capture),
    } as any,
    {
      getJob: async () => ({ getState: async () => "completed" }),
      add: async (_name: string, data: any, options: any) => {
        added.push({ data, options });
      },
    } as any,
  );

  assert.equal(await service.reconcile(), 1);
  assert.equal(capture.where.status, "PENDING");
  assert.equal(capture.where.generationRevision, 2);
  assert.deepEqual(capture.where.jobs, { none: {} });
  assert.deepEqual(capture.deleted, { contentItemId: "item-1" });
  assert.equal(added[0].options.jobId, "generation-item-1-r3");
  assert.equal(added[0].data.forceReview, false);
});

test("restores FAILED when GENERATING recovery enqueue throws", async () => {
  let findManyCall = 0;
  const capture: any = {};
  let restored: any = null;
  const service = new GenerationRecoveryService(
    {
      contentItem: {
        findMany: async () =>
          findManyCall++ === 0 ? [{ id: "item-1", generationRevision: 0 }] : [],
        updateMany: async ({ data }: any) => {
          restored = data;
          return { count: 1 };
        },
      },
      $transaction: transactionMock(1, capture),
    } as any,
    {
      getJob: async () => null,
      add: async () => {
        throw new Error("redis unavailable");
      },
    } as any,
  );

  assert.equal(await service.reconcile(), 0);
  assert.equal(restored.status, "FAILED");
  assert.match(String(restored.lastError), /redis unavailable/);
});
