import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@notionhq/client";
import { IngestPayload } from "../../ingest/ingest.schema";
import { MediaDownloadService } from "../../common/media-download.service";
import {
  externalMediaFingerprint,
  notionHostedFingerprint,
  SourceMediaRef,
} from "../../ingest/media-identity";
import {
  PROP_MATCHERS,
  TABLE_TYPE_FALLBACK,
  TYPE_MAP,
} from "./notion.constants";

// 每个库解析出的实际输入字段名
interface DbSchema {
  title: string;
  sent?: string; // social_media_sent checkbox
  type?: string;
  summary?: string;
  publishLink?: string
}

export interface NotionIngestResult {
  payload: IngestPayload;
  rawPayload: IngestPayload & { mediaRefs: SourceMediaRef[] };
  mediaRefs: SourceMediaRef[];
}

export interface ResolvedSourceMedia {
  ref: SourceMediaRef;
  buffer?: Buffer;
}

export class NotionMediaChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = NotionMediaChangedError.name;
  }
}

const includesAny = (name: string, keys: readonly string[]) => {
  const lower = name.toLowerCase();
  return keys.some((k) => lower.includes(k.toLowerCase()));
};

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);
  readonly client = new Client({
    auth: process.env.NOTION_TOKEN,
    timeoutMs: 90_000, // 单请求显式超时，防止 SDK 默认 60s 对长正文块抓取过紧
  });
  private readonly schemaCache = new Map<
    string,
    { schema: DbSchema; at: number }
  >();
  private static readonly SCHEMA_TTL_MS = 10 * 60 * 1000; // 运营在 Notion 加字段后最多 10 分钟生效

  constructor(private readonly mediaDownloads: MediaDownloadService) {}
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
      if (
        ["rich_text", "select", "status"].includes(prop.type) &&
        includesAny(name, PROP_MATCHERS.type)
      )
        schema.type = name
      if (prop.type === "rich_text" && includesAny(name, PROP_MATCHERS.summary))
        schema.summary = name;
      if (
        ["url", "rich_text", "formula"].includes(prop.type) &&
        includesAny(name, PROP_MATCHERS.publishLink)
      )
        schema.publishLink = name
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
    return this.queryPages(databaseId, since)
  }

  async queryAllReadyPages(databaseId: string) {
    return this.queryPages(databaseId);
  }

  async retrievePage(pageId: string) {
    return (await this.client.pages.retrieve({ page_id: pageId })) as {
      id: string;
      archived?: boolean;
      in_trash?: boolean;
      properties: Record<string, any>;
    };
  }

  async isReadyPage(
    page: {
      archived?: boolean;
      in_trash?: boolean;
      properties: Record<string, any>;
    },
    databaseId: string,
  ): Promise<boolean> {
    if (page.archived || page.in_trash) return false;
    const schema = await this.resolveSchema(databaseId);
    return Boolean(schema.sent && page.properties[schema.sent]?.checkbox === true);
  }

  private async queryPages(databaseId: string, since?: Date, maxItems?: number) {
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
    } while (cursor && (!maxItems || pages.length < maxItems));
    return maxItems ? pages.slice(0, maxItems) : pages;
  }

  // 页面 → 统一 ingest payload。正文取页面块，空则退回「摘要」字段
  async toPayload(
    page: { id: string; properties: Record<string, any> },
    databaseId: string,
    language: string,
    tableType: string,
  ): Promise<NotionIngestResult | null> {
    const schema = await this.resolveSchema(databaseId);
    const props = page.properties;
    const title = this.plainText(props[schema.title]);
    if (!title) return null;

    const rawType = schema.type
      ? this.propertyString(props[schema.type]).trim().toLowerCase()
      : "";
    const typeTokens = rawType
      .split(/[\/|｜,，]/)
      .map((token) => token.trim())
      .filter(Boolean);
    const contentType =
      TYPE_MAP[rawType] ??
      typeTokens.map((token) => TYPE_MAP[token]).find(Boolean) ??
      TABLE_TYPE_FALLBACK[tableType] ??
      "news";

    const publishLink = schema.publishLink
      ? this.propertyString(props[schema.publishLink]).trim()
      : "";
    const fetched = await this.fetchBody(page.id);
    const sourceMedia = fetched.media.slice(0, 1);
    const payload: IngestPayload = {
      external_id: page.id,
      language,
      content_type: contentType as IngestPayload["content_type"],
      title,
      body:
        fetched.body ||
        (schema.summary ? this.plainText(props[schema.summary]) : "") ||
        title,
      media: sourceMedia.map(({ url }) => url),
      target_platforms: [],
      publish_at: undefined,
      source_table_type: tableType,
      publish_link: publishLink || undefined,
    };
    return {
      payload,
      mediaRefs: sourceMedia,
      rawPayload: { ...payload, mediaRefs: sourceMedia },
    };
  }

  async fetchPageMediaRefs(pageId: string): Promise<SourceMediaRef[]> {
    const { media } = await this.fetchBody(pageId);
    return media.slice(0, 1);
  }

  async refreshMediaRefs(
    mediaRefs: SourceMediaRef[],
  ): Promise<ResolvedSourceMedia[]> {
    const refreshed: ResolvedSourceMedia[] = [];
    for (const expected of mediaRefs) {
      if (!expected.blockId) {
        throw new NotionMediaChangedError("Notion 媒体缺少 block provenance，需要重新审核");
      }
      const block = await this.client.blocks.retrieve({ block_id: expected.blockId });
      const current = await this.mediaFromBlock(block as any);
      if (
        !current ||
        current.ref.kind !== expected.kind ||
        current.ref.fingerprintKey !== expected.fingerprintKey
      ) {
        throw new NotionMediaChangedError("Notion 媒体在审核后发生变化，需要重新审核");
      }
      refreshed.push(current);
    }
    return refreshed;
  }

  private async fetchBody(pageId: string) {
    const texts: string[] = [];
    const media: SourceMediaRef[] = [];
    let cursor: string | undefined;
    do {
      const blocks = await this.client.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      });
      for (const block of blocks.results as any[]) {
        const rich = block[block.type]?.rich_text;
        if (rich) texts.push(rich.map((r: any) => r.plain_text).join(""));
        if (!media.length) {
          const sourceMedia = await this.mediaFromBlock(block);
          if (sourceMedia) media.push(sourceMedia.ref);
        }
      }
      cursor = blocks.has_more ? (blocks.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return { body: texts.filter(Boolean).join("\n"), media };
  }

  private async mediaFromBlock(block: any): Promise<ResolvedSourceMedia | null> {
    if (block?.type !== "image") return null;
    const blockId = typeof block.id === "string" ? block.id : "";
    const lastEditedTime =
      typeof block.last_edited_time === "string" ? block.last_edited_time : "";
    if (!blockId || !lastEditedTime) {
      throw new Error("Notion image block missing id or last_edited_time");
    }
    const hostedUrl = block.image?.file?.url;
    if (typeof hostedUrl === "string" && hostedUrl) {
      const buffer = await this.mediaDownloads.downloadPublicImage(hostedUrl);
      const contentDigest = createHash("sha256").update(buffer).digest("hex");
      return {
        ref: {
          kind: "notion-hosted",
          url: hostedUrl,
          blockId,
          lastEditedTime,
          contentDigest,
          fingerprintKey: notionHostedFingerprint(contentDigest),
        },
        buffer,
      };
    }
    const externalUrl = block.image?.external?.url;
    if (typeof externalUrl === "string" && externalUrl) {
      return {
        ref: {
          kind: "external",
          url: externalUrl,
          blockId,
          lastEditedTime,
          fingerprintKey: externalMediaFingerprint(externalUrl),
        },
      };
    }
    return null;
  }

  private plainText(prop: any): string {
    return (prop?.title ?? prop?.rich_text ?? [])
      .map((r: any) => r.plain_text)
      .join("");
  }

  private propertyString(prop: any): string {
    if (typeof prop?.url === "string") return prop.url;
    if (typeof prop?.select?.name === "string") return prop.select.name;
    if (typeof prop?.status?.name === "string") return prop.status.name;
    if (typeof prop?.formula?.string === "string") return prop.formula.string;
    return this.plainText(prop)
  }
}
