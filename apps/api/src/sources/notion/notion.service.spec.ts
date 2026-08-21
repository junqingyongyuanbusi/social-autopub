import assert from "node:assert/strict";
import test from "node:test";
import { NotionService } from "./notion.service";

function richText(value: string) {
  return [{ plain_text: value }];
}

function createService(
  downloadPublicImage: (url: string) => Promise<Buffer> = async () =>
    Buffer.from("image"),
) {
  return new NotionService({ downloadPublicImage } as any);
}

for (const [name, property] of [
  ["url", { type: "url", url: "https://example.com/report" }],
  ["rich_text", { type: "rich_text", rich_text: richText("https://example.com/report") }],
  ["formula", { type: "formula", formula: { type: "string", string: "https://example.com/report" } }],
] as const) {
  test(`extracts Publish link from Notion ${name} properties`, async () => {
    const service = createService();
    (service as any).client = {
      databases: {
        retrieve: async () => ({
          properties: {
            Name: { type: "title" },
            social_media_sent: { type: "checkbox" },
            文章类型: { type: "rich_text" },
            "发布链接 / Publish link": property,
          },
        }),
      },
    };
    (service as any).fetchBody = async () => ({ body: "body", media: [] });

    const result = await service.toPayload(
      {
        id: "page-1",
        properties: {
          Name: { title: richText("Title") },
          文章类型: { rich_text: richText("review") },
          "发布链接 / Publish link": property,
        },
      },
      `db-${name}`,
      "en",
      "exposure-review",
    );

    assert.equal(result?.payload.publish_link, "https://example.com/report");
    assert.equal(result?.payload.source_table_type, "exposure-review");
  });
}

test("maps bilingual select article types for exposure-review CTA selection", async () => {
  const service = createService();
  (service as any).client = {
    databases: {
      retrieve: async () => ({
        properties: {
          Name: { type: "title" },
          social_media_sent: { type: "checkbox" },
          文章类型: { type: "select" },
          "发布链接 / Publish link": { type: "url" },
        },
      }),
    },
  };
  (service as any).fetchBody = async () => ({ body: "body", media: [] });

  for (const [value, expected] of [
    ["review / 测评", "review"],
    ["exposure / 曝光", "exposure"],
  ]) {
    const result = await service.toPayload(
      {
        id: `page-${expected}`,
        properties: {
          Name: { title: richText("Title") },
          文章类型: { select: { name: value } },
          "发布链接 / Publish link": { url: "https://example.com/report" },
        },
      },
      "db-bilingual",
      "en",
      "exposure-review",
    );
    assert.equal(result?.payload.content_type, expected);
  }
});

test("reads bilingual article type from Notion status properties", async () => {
  const service = createService();
  (service as any).client = {
    databases: {
      retrieve: async () => ({
        properties: {
          Name: { type: "title" },
          social_media_sent: { type: "checkbox" },
          内容类型: { type: "status" },
          "发布链接 / Publish link": { type: "url" },
        },
      }),
    },
  };
  (service as any).fetchBody = async () => ({ body: "body", media: [] });
  const result = await service.toPayload(
    {
      id: "page-status",
      properties: {
        Name: { title: richText("Title") },
        内容类型: { status: { name: "review / 测评" } },
        "发布链接 / Publish link": { url: "https://example.com/report" },
      },
    },
    "db-status",
    "en",
    "exposure-review",
  );
  assert.equal(result?.payload.content_type, "review");
});

test("full pagination returns more than 500 ready pages", async () => {
  const service = createService();
  (service as any).resolveSchema = async () => ({ title: "Name", sent: "social_media_sent" });
  let call = 0;
  (service as any).client = {
    databases: {
      query: async () => {
        call++;
        return {
          results: Array.from({ length: 100 }, (_, index) => ({
            id: `${call}-${index}`,
            properties: {},
          })),
          has_more: call < 6,
          next_cursor: call < 6 ? `cursor-${call}` : null,
        };
      },
    },
  };

  const pages = await service.queryAllReadyPages("db");
  assert.equal(pages.length, 600);
  assert.equal(call, 6);
});

test("trash pages are not eligible for failure retry", async () => {
  const service = createService();
  (service as any).resolveSchema = async () => ({
    title: "Name",
    sent: "social_media_sent",
  });
  assert.equal(
    await service.isReadyPage(
      {
        in_trash: true,
        properties: { social_media_sent: { checkbox: true } },
      },
      "db",
    ),
    false,
  );
  assert.equal(
    await service.isReadyPage(
      {
        archived: false,
        in_trash: false,
        properties: { social_media_sent: { checkbox: true } },
      },
      "db",
    ),
    true,
  );
});
