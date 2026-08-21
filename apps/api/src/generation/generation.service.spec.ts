import assert from "node:assert/strict";
import test from "node:test";
import { GenerationService } from "./generation.service";
import { DEFAULT_PROMPT_CONFIG } from "./prompts";

function serviceHarness(options: {
  item: Record<string, any>;
  initialRevision: number;
  llmContent: string;
  onComplete?: () => void;
}) {
  let status = "PENDING";
  let revision = options.initialRevision;
  const transitions: Array<Record<string, unknown>> = [];
  const saved: Array<Record<string, unknown>> = [];
  let published = false;
  const prisma = {
    contentItem: {
      updateMany: async ({ where, data }: any) => {
        const statusMatches = Array.isArray(where.status?.in)
          ? where.status.in.includes(status)
          : where.status === status;
        if (
          where.id === options.item.id &&
          statusMatches &&
          (where.generationRevision === undefined || where.generationRevision === revision)
        ) {
          transitions.push(data);
          if (typeof data.status === "string") status = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUniqueOrThrow: async () => ({ ...options.item, generationRevision: revision }),
      findUnique: async () => ({ status, generationRevision: revision }),
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        contentItem: {
          updateMany: async ({ where }: any) => ({
            count:
              where.id === options.item.id &&
              where.status === status &&
              where.generationRevision === revision
                ? 1
                : 0,
          }),
        },
        generation: {
          upsert: async (args: Record<string, unknown>) => {
            saved.push(args);
            return args;
          },
        },
      }),
  };
  const service = new GenerationService(
    prisma as any,
    { platformsFor: async () => ["x"] } as any,
    {
      targetSnapshot: async () => [
        { platform: "x", postizIntegrationId: "integration-1" },
      ],
      dispatch: async () => { published = true; },
    } as any,
    {
      complete: async () => {
        options.onComplete?.();
        return JSON.stringify({ content: options.llmContent });
      },
    } as any,
    { getActive: async () => DEFAULT_PROMPT_CONFIG } as any,
  );
  return {
    service,
    transitions,
    saved,
    published: () => published,
    setOwnership(nextStatus: string, nextRevision: number) {
      status = nextStatus;
      revision = nextRevision;
    },
  };
}

const baseItem = {
  id: "item-1",
  source: "notion",
  sourceTableType: "exposure-review",
  publishLink: "https://example.com/report",
  language: "en",
  contentType: "review",
  title: "Title",
  body: "Body",
  media: [],
  targetPlatforms: ["x"],
  forceReview: false,
};

test("combined over-limit content forces REVIEW even when AUTO_PUBLISH is enabled", async () => {
  const harness = serviceHarness({
    item: baseItem,
    initialRevision: 0,
    llmContent: "界".repeat(300),
  });
  const previous = process.env.AUTO_PUBLISH;
  process.env.AUTO_PUBLISH = "true";
  try {
    await harness.service.generateFor(baseItem.id, false, 0);
  } finally {
    if (previous === undefined) delete process.env.AUTO_PUBLISH;
    else process.env.AUTO_PUBLISH = previous;
  }

  const finalTransition = harness.transitions.at(-1) ?? {};
  assert.equal(finalTransition.status, "REVIEW");
  assert.match(String(finalTransition.lastError), /超出 X 长度限制/);
  assert.equal(harness.published(), false);
  assert.equal((harness.saved[0] as any).create.content, "界".repeat(300));
});

test("forceReview job payload persists protection when DB flag was false", async () => {
  const harness = serviceHarness({
    item: { ...baseItem, id: "item-2", forceReview: false },
    initialRevision: 1,
    llmContent: "Short summary",
  });
  const previous = process.env.AUTO_PUBLISH;
  process.env.AUTO_PUBLISH = "true";
  try {
    await harness.service.generateFor("item-2", true, 1);
  } finally {
    if (previous === undefined) delete process.env.AUTO_PUBLISH;
    else process.env.AUTO_PUBLISH = previous;
  }

  assert.equal(harness.transitions.at(-1)?.status, "REVIEW");
  assert.equal(harness.transitions.at(-1)?.forceReview, true);
  assert.equal(harness.published(), false);
});

test("old revision handler cannot write or finish after recovery advances ownership", async () => {
  let harness: ReturnType<typeof serviceHarness>;
  harness = serviceHarness({
    item: { ...baseItem, id: "item-3" },
    initialRevision: 0,
    llmContent: "Old handler result",
    onComplete: () => harness.setOwnership("GENERATING", 1),
  });

  await harness.service.generateFor("item-3", false, 0);

  assert.equal(harness.saved.length, 0);
  assert.equal(harness.transitions.length, 1);
  assert.equal(harness.transitions[0].status, "GENERATING");
  assert.equal(harness.published(), false);
});
