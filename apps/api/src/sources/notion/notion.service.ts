import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@notionhq/client";
import {
  PROP_MATCHERS,
  TABLE_TYPE_FALLBACK,
  TYPE_MAP,
} from "./notion.constants";
import { IngestPayload } from "../../ingest/ingest.schema";

// 每个库解析出的实际输入字段名
interface DbSchema {
  title: string;
  sent?: string; // social_media_sent checkbox
  publishAt?: string;
  type?: string;
  summary?: string;
}

const includesAny = (name: string, keys: readonly string[]) => {
  const lower = name.toLowerCase();
  return keys.some((k) => lower.includes(k.toLowerCase()));
};

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);
  readonly client = new Client({ auth: process.env.NOTION_TOKEN });
  private readonly schemaCache = new Map<
    string,
    { schema: DbSchema; at: number }
  >();
  private static readonly SCHEMA_TTL_MS = 10 * 60 * 1000; // 运营在 Notion 加字段后最多 10 分钟生效

  // 解析并缓存某库的实际字段名（各语言库命名不一致，模糊匹配）
  async resolveSchema(databaseId: string): Promise<DbSchema> {
    const cached = this.schemaCache.get(databaseId);
    if (cached && Date.now() - cached.at < NotionService.SCHEMA_TTL_MS)
      return cached.schema;

    const db = (await this.client.databases.retrieve({
      database_id: databaseId,
    })) as {
      properties: Record<string, any>;
    };
    const schema: DbSchema = { title: "" };

    for (const [name, prop] of Object.entries(db.properties)) {
      if (prop.type === "title") schema.title = name;
      if (prop.type === "checkbox" && includesAny(name, PROP_MATCHERS.sent))
        schema.sent = name;
      if (prop.type === "date" && includesAny(name, PROP_MATCHERS.publishAt))
        schema.publishAt = name;
      if (prop.type === "rich_text" && includesAny(name, PROP_MATCHERS.type))
        schema.type = name;
      if (prop.type === "rich_text" && includesAny(name, PROP_MATCHERS.summary))
        schema.summary = name;
    }

    if (!schema.sent) {
      this.logger.warn(
        `库 ${databaseId} 未添加 social_media_sent 字段，将跳过拾取`,
      );
    }
    this.schemaCache.set(databaseId, { schema, at: Date.now() });
    return schema;
  }

  // 拾取条件：仅 social_media_sent=true（防重复靠系统内部幂等键）；
  // 未添加该字段的库直接跳过，不做任何拾取
  async queryReadyPages(databaseId: string, since?: Date) {
    const schema = await this.resolveSchema(databaseId);
    if (!schema.sent) return [];

    const and: object[] = [
      { property: schema.sent, checkbox: { equals: true } },
    ];
    if (since)
      and.push({
        timestamp: "last_edited_time",
        last_edited_time: { on_or_after: since.toISOString() },
      });

    const pages: Array<{ id: string; properties: Record<string, any> }> = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({
        database_id: databaseId,
        filter: { and } as never,
        page_size: 100,
        start_cursor: cursor,
      });
      pages.push(
        ...(res.results as Array<{
          id: string;
          properties: Record<string, any>;
        }>),
      );
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor && pages.length < 500);
    return pages;
  }

  // 页面 → 统一 ingest payload。正文取页面块，空则退回「摘要」字段
  async toPayload(
    page: { id: string; properties: Record<string, any> },
    databaseId: string,
    language: string,
    tableType: string,
  ): Promise<IngestPayload | null> {
    const schema = await this.resolveSchema(databaseId);
    const props = page.properties;
    const title = this.plainText(props[schema.title]);
    if (!title) return null;

    const rawType = schema.type
      ? this.plainText(props[schema.type]).trim().toLowerCase()
      : "";
    const contentType =
      TYPE_MAP[rawType] ?? TABLE_TYPE_FALLBACK[tableType] ?? "news";

    const { body, media } = await this.fetchBody(page.id);
    return {
      external_id: page.id,
      language,
      content_type: contentType as IngestPayload["content_type"],
      title,
      body:
        body ||
        (schema.summary ? this.plainText(props[schema.summary]) : "") ||
        title,
      media: media.slice(0, 1), // 暂定只取 Notion 正文首图作配图
      target_platforms: [], // 表内无平台字段，全部按路由矩阵默认
      publish_at: schema.publishAt
        ? (props[schema.publishAt]?.date?.start ?? undefined)
        : undefined,
    };
  }

  private async fetchBody(pageId: string) {
    const blocks = await this.client.blocks.children.list({
      block_id: pageId,
      page_size: 60,
    });
    const texts: string[] = [];
    const media: string[] = [];
    for (const block of blocks.results as any[]) {
      const rich = block[block.type]?.rich_text;
      if (rich) texts.push(rich.map((r: any) => r.plain_text).join(""));
      if (block.type === "image") {
        const url = block.image?.file?.url ?? block.image?.external?.url;
        if (url) media.push(url);
      }
    }
    return { body: texts.filter(Boolean).join("\n"), media };
  }

  private plainText(prop: any): string {
    return (prop?.title ?? prop?.rich_text ?? [])
      .map((r: any) => r.plain_text)
      .join("");
  }
}
