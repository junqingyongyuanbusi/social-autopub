// Notion 字段适配规则：各语言库字段命名不完全一致（有的带双语后缀、有的纯中文），
// 按关键字模糊匹配实际字段名，规则只在这里维护
export const PROP_MATCHERS = {
  sent: ["social_media_sent"], // checkbox：唯一触发条件，勾选后立即发布
  type: ["文章类型", "内容类型"],
  summary: ["摘要", "summary"],
} as const;

// 文章类型字段值 → 系统内容类型（大小写不敏感，兼容中英文写法）
export const TYPE_MAP: Record<string, string> = {
  news: "news",
  新闻: "news",
  education: "education",
  教育: "education",
  review: "review",
  测评: "review",
  exposure: "exposure",
  曝光: "exposure",
};

// 文章类型缺失时按库类型兜底
export const TABLE_TYPE_FALLBACK: Record<string, string> = {
  "news-edu": "news",
  "exposure-review": "exposure",
};
