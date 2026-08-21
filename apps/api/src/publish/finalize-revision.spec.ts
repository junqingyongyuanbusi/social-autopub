import assert from "node:assert/strict";
import test from "node:test";
import { concludePublishRevision } from "./finalize-revision";

function fakeDb(
  statuses: string[],
  updateResult = { count: 1 },
) {
  const calls: { updateMany?: { where: unknown; data: unknown }[] } = {
    updateMany: [],
  };
  return {
    publishJob: {
      findMany: async () => statuses.map((status) => ({ status })),
    },
    contentItem: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        calls.updateMany!.push(args);
        return updateResult;
      },
    },
    calls,
  };
}

test("all sent publishes the content and clears lastError", async () => {
  const db = fakeDb(["sent", "sent"]);
  const result = await concludePublishRevision(db as any, "item-1", 2);

  assert.deepEqual(result, { outcome: "PUBLISHED", applied: true });
  assert.equal(db.calls.updateMany!.length, 1);
  assert.deepEqual(db.calls.updateMany![0], {
    where: { id: "item-1", status: "PUBLISHING", publishRevision: 2 },
    data: { status: "PUBLISHED", lastError: null },
  });
});

test("any non-sent terminal job concludes the content as FAILED and keeps lastError", async () => {
  const db = fakeDb(["sent", "failed"]);
  const result = await concludePublishRevision(db as any, "item-1", 2);

  assert.deepEqual(result, { outcome: "FAILED", applied: true });
  assert.deepEqual(db.calls.updateMany![0].data, { status: "FAILED" });
});

test("in-flight jobs block conclusion without touching the content row", async () => {
  for (const status of ["queued", "publishing", "unknown"]) {
    const db = fakeDb(["sent", status]);
    const result = await concludePublishRevision(db as any, "item-1", 2);
    assert.deepEqual(result, { outcome: null, applied: false });
    assert.equal(db.calls.updateMany!.length, 0);
  }
});

test("a revision without jobs concludes nothing", async () => {
  const db = fakeDb([]);
  const result = await concludePublishRevision(db as any, "item-1", 9);
  assert.deepEqual(result, { outcome: null, applied: false });
  assert.equal(db.calls.updateMany!.length, 0);
});

test("a stale revision guard miss reports the outcome without claiming application", async () => {
  const db = fakeDb(["sent"], { count: 0 });
  const result = await concludePublishRevision(db as any, "item-1", 1);
  assert.deepEqual(result, { outcome: "PUBLISHED", applied: false });
});
