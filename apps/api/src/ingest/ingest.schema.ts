import { z } from 'zod';

// 所有来源归一的统一内容 schema（Notion 与 HTTP ingest 共用）
export const ingestSchema = z.object({
  external_id: z.string().min(1),
  language: z.string().min(2).max(10),
  content_type: z.enum(['news', 'education', 'review', 'exposure']),
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  media: z.array(z.string().url()).default([]),
  target_platforms: z.array(z.enum(['x', 'instagram', 'facebook'])).default([]),
  publish_at: z.string().datetime().optional(),
  source_table_type: z.string().min(1).optional(),
  publish_link: z.string().optional()
});

export type IngestPayload = z.infer<typeof ingestSchema>;
