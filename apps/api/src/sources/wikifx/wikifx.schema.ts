import { z } from 'zod';

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().finite().nonnegative().nullable().optional();

const articleIdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1));
const languageSchema = z.string().trim().toLowerCase().min(2).max(10);

export const wikifxArticleSchema = z
  .object({
    article_id: articleIdSchema,
    language: languageSchema,
    article_url: z.string(),
    article_title: z.string().min(1).max(500),
    content_country: nullableString,
    content_region: nullableString,
    view_count: z.number().finite().nonnegative(),
    active_users: z.number().finite().nonnegative(),
    avg_engagement_seconds: z.number().finite().nonnegative(),
    click_count: nullableNumber,
    read_count: nullableNumber,
    content: nullableString,
    content_message: nullableString,
    content_status: nullableString,
    first_image_url: nullableString,
  })
  .passthrough();

export const wikifxTopResponseSchema = z.object({
  statistics_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statistics_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(3),
  top: z.number().int().min(1).max(20),
  property_id: z.union([z.string(), z.number()]).transform(String),
  data_quality: z.object({
    sampled: z.boolean(),
    data_loss_from_other_row: z.boolean(),
    skipped_rows: z.number(),
  }),
  items: z.array(wikifxArticleSchema),
});

export const wikifxTopicsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3).default(3),
  top: z.coerce.number().int().min(1).max(20).default(1),
});

export const wikifxAdoptSchema = z.object({
  article_id: articleIdSchema,
  language: languageSchema,
  days: z.coerce.number().int().min(1).max(3).optional(),
});

export type WikifxArticle = z.infer<typeof wikifxArticleSchema>;
export type WikifxTopResponse = z.infer<typeof wikifxTopResponseSchema>;
