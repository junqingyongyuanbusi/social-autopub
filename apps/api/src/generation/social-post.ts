import { parseTweet } from "twitter-text";

export interface SocialPostItem {
  source: string;
  sourceTableType: string | null;
  publishLink: string | null;
  language: string;
  contentType: string;
}

export interface ComposedPost {
  content: string;
  suffix: string;
  publicUrl: string | null;
  problems: string[];
  measuredLength: number;
  limit: number | null;
}

const CTA_BY_LANGUAGE: Record<
  string,
  { review: string; report: string }
> = {
  af: { review: "Full Review", report: "Full Report" },
  en: { review: "Full Review", report: "Full Report" },
  sa: { review: "Full Review", report: "Full Report" },
  me: { review: "المراجعة الكاملة", report: "التقرير الكامل" },
  es: { review: "Reseña completa", report: "Informe completo" },
  fr: { review: "Avis complet", report: "Rapport complet" },
  id: { review: "Ulasan Lengkap", report: "Laporan Lengkap" },
  ja: { review: "レビュー全文", report: "レポート全文" },
  ko: { review: "전체 리뷰", report: "전체 보고서" },
  ms: { review: "Ulasan Penuh", report: "Laporan Penuh" },
  pt: { review: "Análise completa", report: "Relatório completo" },
  th: { review: "รีวิวฉบับเต็ม", report: "รายงานฉบับเต็ม" },
  vi: { review: "Đánh giá đầy đủ", report: "Báo cáo đầy đủ" },
  "zh-cn": { review: "完整测评", report: "完整报告" },
  "zh-tw": { review: "完整評測", report: "完整報告" },
  "zh-mt": { review: "完整测评", report: "完整报告" },
};

export const EXPOSURE_REVIEW_LINK_ERROR_PREFIX = "发布链接 / Publish link";

export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}
export function requiresExposureReviewLink(item: SocialPostItem): boolean {
  return item.source === "notion" && item.sourceTableType === "exposure-review";
}

export function publicPublishUrl(rawLink: string | null): string {
  if (!rawLink?.trim()) {
    throw new Error(`${EXPOSURE_REVIEW_LINK_ERROR_PREFIX} 缺失，请在 Notion 补充后重试`);
  }
  let url: URL;
  try {
    url = new URL(rawLink.trim());
  } catch {
    throw new Error(`${EXPOSURE_REVIEW_LINK_ERROR_PREFIX} 格式无效，请填写完整的 http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${EXPOSURE_REVIEW_LINK_ERROR_PREFIX} 仅支持 http(s) URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${EXPOSURE_REVIEW_LINK_ERROR_PREFIX} 不允许包含用户名或密码`);
  }
  url.hostname = url.hostname.replace(/\.com$/i, ".me");
  return url.toString();
}

export function exposureReviewLinkProblem(item: SocialPostItem): string | null {
  if (!requiresExposureReviewLink(item)) return null;
  try {
    publicPublishUrl(item.publishLink);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export function systemSuffix(item: SocialPostItem): string {
  if (!requiresExposureReviewLink(item)) return "";
  const publicUrl = publicPublishUrl(item.publishLink);
  const labels = CTA_BY_LANGUAGE[item.language.toLowerCase()] ?? CTA_BY_LANGUAGE.en;
  const label = item.contentType === "review" ? labels.review : labels.report;
  return `${label}: ${publicUrl}`;
}

export function measurePlatformContent(platform: string, content: string): number {
  if (platform === "x") return parseTweet(content).weightedLength;
  return content.length;
}

// 平台默认文本上限：X 免费账号为 280 加权字符。
// 订阅账号可发长文，由 Account.textLimit 覆盖（见 platformLimit 的 accountTextLimit 参数）。
export const X_DEFAULT_LIMIT = 280;

// accountTextLimit 来自 Account.textLimit：订阅账号填实际上限，留空则回落平台默认值。
export function platformLimit(
  platform: string,
  accountTextLimit?: number | null,
): number | null {
  if (platform === "x") return accountTextLimit ?? X_DEFAULT_LIMIT;
  if (platform === "instagram") return 2200;
  if (platform === "facebook") return 5000;
  return null;
}

export function composeSocialPost(
  platform: string,
  body: string,
  item: SocialPostItem,
  accountTextLimit?: number | null,
): ComposedPost {
  const suffix = systemSuffix(item);
  const content = suffix ? `${body.trimEnd()}\n\n${suffix}` : body;
  const measuredLength = measurePlatformContent(platform, content);
  const limit = platformLimit(platform, accountTextLimit);
  const problems: string[] = [];
  if (limit !== null && measuredLength > limit) {
    problems.push(`超出 ${platform} 长度限制（${measuredLength}/${limit}），请精简正文`);
  }
  return {
    content,
    suffix,
    publicUrl: suffix ? publicPublishUrl(item.publishLink) : null,
    problems,
    measuredLength,
    limit,
  };
}

export function bodyBudget(
  platform: string,
  item: SocialPostItem,
  accountTextLimit?: number | null,
): number | null {
  const limit = platformLimit(platform, accountTextLimit);
  if (limit === null) return null;
  const suffix = systemSuffix(item);
  if (!suffix) return limit;
  return Math.max(0, limit - measurePlatformContent(platform, `\n\n${suffix}`));
}
