import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ComposeController } from "./compose.controller";

const mockUser = { id: "user-1", role: "operator" as const };

test("compose rejects account not visible to user", async () => {
  const controller = new ComposeController(
    {
      account: {
        findMany: async () => [],
      },
    } as any,
    {
      visibleAccountIds: async () => ["other-account"],
    } as any,
    {} as any,
  );

  await assert.rejects(
    async () => {
      await controller.publishNow(mockUser, {
        language: "en",
        text: "hello",
        accounts: [{ platform: "x", accountId: "acc-forbidden" }],
        media: { landscape: { id: "m1", path: "https://example.invalid/m1.jpg" } },
      });
    },
    (err: any) =>
      err instanceof BadRequestException &&
      err.message.includes("所选账号不存在或未获授权"),
  );
});

test("compose rejects disconnected account", async () => {
  const controller = new ComposeController(
    {
      account: {
        findMany: async () => [
          {
            id: "acc-disc",
            name: "My X",
            platform: "x",
            status: "disconnected",
            postizIntegrationId: "int-1",
          },
        ],
      },
    } as any,
    {
      visibleAccountIds: async () => ["acc-disc"],
    } as any,
    {} as any,
  );

  await assert.rejects(
    async () => {
      await controller.publishNow(mockUser, {
        language: "en",
        text: "hello",
        accounts: [{ platform: "x", accountId: "acc-disc" }],
        media: { landscape: { id: "m1", path: "https://example.invalid/m1.jpg" } },
      });
    },
    (err: any) =>
      err instanceof BadRequestException &&
      err.message.includes("当前失联"),
  );
});

test("compose rejects instagram without 4:5 media", async () => {
  const controller = new ComposeController(
    {
      account: {
        findMany: async () => [
          {
            id: "acc-ig",
            name: "My IG",
            platform: "instagram",
            status: "active",
            postizIntegrationId: "int-ig",
          },
        ],
      },
    } as any,
    {
      visibleAccountIds: async () => ["acc-ig"],
    } as any,
    {} as any,
  );

  await assert.rejects(
    async () => {
      await controller.publishNow(mockUser, {
        language: "en",
        text: "hello",
        accounts: [{ platform: "instagram", accountId: "acc-ig" }],
        media: {},
      });
    },
    (err: any) =>
      err instanceof BadRequestException &&
      err.message.includes("必须上传 4:5 图片"),
  );
});

test("compose successfully creates content, generations and dispatches publish", async () => {
  let createdItemData: any = null;
  const createdGenerations: any[] = [];
  let dispatchedId = "";
  let dispatchedTargets: any[] = [];

  const controller = new ComposeController(
    {
      account: {
        findMany: async () => [
          {
            id: "acc-ig",
            name: "My IG",
            platform: "instagram",
            status: "active",
            postizIntegrationId: "int-ig-1",
          },
          {
            id: "acc-x",
            name: "My X",
            platform: "x",
            status: "active",
            postizIntegrationId: "int-x-1",
          },
        ],
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            create: async ({ data }: any) => {
              createdItemData = data;
              return { id: "item-created-1", ...data };
            },
          },
          generation: {
            create: async ({ data }: any) => {
              createdGenerations.push(data);
              return { id: `gen-${data.platform}`, ...data };
            },
          },
        }),
    } as any,
    {
      visibleAccountIds: async () => ["acc-ig", "acc-x"],
    } as any,
    {
      dispatch: async (id: string, targets: any[]) => {
        dispatchedId = id;
        dispatchedTargets = targets;
        return 1;
      },
    } as any,
  );

  const res = await controller.publishNow(mockUser, {
    language: "ja",
    text: "新着ニュース\n詳細は本文にて",
    accounts: [
      { platform: "instagram", accountId: "acc-ig" },
      { platform: "x", accountId: "acc-x" },
    ],
    media: {
      instagram: { id: "media-ig", path: "https://postiz.invalid/ig.jpg" },
      landscape: { id: "media-x", path: "https://postiz.invalid/16x9.jpg" },
    },
  });

  assert.equal(res.contentItemId, "item-created-1");
  assert.equal(res.status, "PUBLISHING");
  assert.deepEqual(res.platforms, ["instagram", "x"]);

  assert.equal(createdItemData.source, "manual");
  assert.equal(createdItemData.status, "APPROVED");
  assert.equal(createdItemData.language, "ja");
  assert.equal(createdItemData.title, "新着ニュース");
  assert.deepEqual(createdItemData.targetAccountIds, ["acc-ig", "acc-x"]);
  assert.deepEqual(createdItemData.publishTargets, [
    { platform: "instagram", postizIntegrationId: "int-ig-1" },
    { platform: "x", postizIntegrationId: "int-x-1" },
  ]);

  assert.equal(createdGenerations.length, 2);
  const igGen = createdGenerations.find((g) => g.platform === "instagram");
  const xGen = createdGenerations.find((g) => g.platform === "x");
  assert.deepEqual(igGen.preparedMedia, [{ id: "media-ig", path: "https://postiz.invalid/ig.jpg" }]);
  assert.deepEqual(xGen.preparedMedia, [{ id: "media-x", path: "https://postiz.invalid/16x9.jpg" }]);

  assert.equal(dispatchedId, "item-created-1");
  assert.deepEqual(dispatchedTargets, createdItemData.publishTargets);
});

test("compose correctly parses and stores publishAt datetime", async () => {
  let createdItemData: any = null;
  const scheduledIso = "2026-10-01T15:30:00.000Z";

  const controller = new ComposeController(
    {
      account: {
        findMany: async () => [
          {
            id: "acc-x-sched",
            name: "My X Sched",
            platform: "x",
            status: "active",
            postizIntegrationId: "int-x-sched",
          },
        ],
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          contentItem: {
            create: async ({ data }: any) => {
              createdItemData = data;
              return { id: "item-sched-1", ...data };
            },
          },
          generation: {
            create: async ({ data }: any) => {
              return { id: "gen-x", ...data };
            },
          },
        }),
    } as any,
    {
      visibleAccountIds: async () => ["acc-x-sched"],
    } as any,
    {
      dispatch: async () => 1,
    } as any,
  );

  const res = await controller.publishNow(mockUser, {
    language: "en",
    text: "Scheduled announcement",
    accounts: [{ platform: "x", accountId: "acc-x-sched" }],
    media: {
      landscape: { id: "media-1", path: "https://postiz.invalid/16x9.jpg" },
    },
    publishAt: scheduledIso,
  });

  assert.equal(res.contentItemId, "item-sched-1");
  assert.ok(createdItemData.publishAt instanceof Date);
  assert.equal(createdItemData.publishAt.toISOString(), scheduledIso);
});
