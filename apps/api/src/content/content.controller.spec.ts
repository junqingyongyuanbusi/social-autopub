import assert from "node:assert/strict";
import test from "node:test";
import { ContentController } from "./content.controller";

test("generation edit CAS rejects when approval wins the race", async () => {
  let guardedStatus: unknown;
  const controller = new ContentController(
    {
      contentItem: {
        findUniqueOrThrow: async () => ({ id: "item-1", status: "REVIEW", language: "en" }),
      },
      generation: {
        updateMany: async ({ where }: { where: any }) => {
          guardedStatus = where.contentItem?.status;
          return { count: 0 };
        },
      },
    } as any,
    { targetIntegrationIds: async () => [] } as any,
    { assertPermission: async () => undefined } as any,
    {} as any,
    {} as any,
  );

  await assert.rejects(
    () =>
      controller.editGeneration(
        { id: "user-1", role: "admin" } as any,
        "item-1",
        "x",
        { content: "changed after approval" },
      ),
    /no longer awaiting review/,
  );
  assert.equal(guardedStatus, "REVIEW");
});

test("regenerate restores FAILED when queue enqueue fails", async () => {
  let restored: Record<string, unknown> | null = null;
  const prisma = {
    contentItem: {
      findUnique: async () => ({ id: "item-1", status: "REVIEW", language: "en" }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        restored = data;
        return { count: 1 };
      },
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        contentItem: {
          updateMany: async () => ({ count: 1 }),
          findUniqueOrThrow: async () => ({ generationRevision: 2, forceReview: false }),
        },
        generation: { deleteMany: async () => ({ count: 1 }) },
      }),
  };
  const controller = new ContentController(
    prisma as any,
    {} as any,
    { assertPermission: async () => undefined } as any,
    { add: async () => { throw new Error("redis unavailable"); } } as any,
    {} as any,
  );

  await assert.rejects(
    () => controller.regenerate({ id: "user-1", role: "admin" } as any, "item-1"),
    /redis unavailable/,
  );
  const restoredData = restored as Record<string, unknown> | null;
  assert.equal(restoredData?.status, "FAILED");
  assert.match(String(restoredData?.lastError), /redis unavailable/);
});

test("bulk requeue reports enqueue failures and restores FAILED", async () => {
  let restored = 0;
  const controller = new ContentController(
    {
      contentItem: {
        findMany: async () => [{ id: "item-1", forceReview: false }],
        updateMany: async () => {
          restored++;
          return { count: 1 };
        },
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            updateMany: async () => ({ count: 1 }),
            findUniqueOrThrow: async () => ({ generationRevision: 3 }),
          },
          generation: { deleteMany: async () => ({ count: 1 }) },
        }),
    } as any,
    {} as any,
    {} as any,
    { add: async () => { throw new Error("redis unavailable"); } } as any,
    {} as any,
  );

  assert.deepEqual(await controller.requeueFailed(), { requeued: 0, enqueueFailed: 1 });
  assert.equal(restored, 1);
});

test("approve rejects an incomplete publish target snapshot", async () => {
  let approved = false;
  const controller = new ContentController(
    {
      contentItem: {
        findUniqueOrThrow: async () => ({
          id: "item-1",
          status: "REVIEW",
          language: "en",
          generations: [
            { platform: "x" },
            { platform: "facebook" },
            { platform: "instagram" },
          ],
        }),
        updateMany: async () => {
          approved = true;
          return { count: 1 };
        },
      },
    } as any,
    {
      targetSnapshot: async () => [
        { platform: "x", postizIntegrationId: "x-account" },
        { platform: "facebook", postizIntegrationId: "fb-account" },
      ],
    } as any,
    {
      assertIntegrationPermission: async () => undefined,
      assertPermission: async () => undefined,
    } as any,
    {} as any,
    {} as any,
  );

  await assert.rejects(
    () => controller.approve({ id: "user-1", role: "admin" } as any, "item-1"),
    /instagram/,
  );
  assert.equal(approved, false);
});
