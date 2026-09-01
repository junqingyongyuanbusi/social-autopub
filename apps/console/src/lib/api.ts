// API 访问薄封装：所有页面统一经此取数
// 服务端组件直连 API 并携带管理密钥；浏览器一律走 /api/proxy（密钥不出服务端）
const isServer = typeof window === "undefined";
const API = isServer
  ? (process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3000")
  : "/api/proxy";

export interface Generation {
  platform: string;
  content: string;
  media: string[];
  systemSuffix?: string;
  finalContent?: string;
  measuredLength?: number;
  platformLimit?: number | null;
  previewProblem?: string | null
}

export interface PublishJobRow {
  id: string;
  platform: string;
  status: string;
  error?: string | null;
  postizPostId?: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  contentItem?: { title: string; language: string; contentType: string };
}

export interface ContentItem {
  id: string;
  source: string;
  externalId: string;
  language: string;
  contentType: string;
  title: string;
  body?: string;
  status: string;
  sourceTableType?: string | null;
  publishLink?: string | null;
  lastError?: string | null
  publishAt?: string | null;
  createdAt: string;
  rawPayload?: unknown | null;
  generations: Generation[];
  jobs: PublishJobRow[];
}

export interface ContentListParams {
  status?: string;
  language?: string;
  contentType?: string;
  source?: string;
}

export type WikiFxCacheStatus = "upstream" | "local-fresh" | "local-stale";

export interface WikiFxDataQuality {
  sampled: boolean;
  data_loss_from_other_row: boolean;
  skipped_rows: number;
}

export interface WikiFxCache {
  status: WikiFxCacheStatus;
  fetched_at: string;
  wikifx_cache: string | null;
  age: string | null;
  request_id: string | null;
}

export interface WikiFxAdoption {
  content_item_id: string;
  status: string;
  created_at: string;
}

export interface WikiFxTopic {
  id: string;
  article_id: string;
  language: string;
  title: string;
  url: string | null;
  country: string | null;
  region: string | null;
  view_count: number;
  active_users: number;
  avg_engagement_seconds: number;
  click_count: number | null;
  read_count: number | null;
  content: string | null;
  content_message: string | null;
  content_status: string | null;
  first_image_url: string | null;
  adoption: WikiFxAdoption | null;
}

export interface WikiFxTopicsResponse {
  statistics_start: string;
  statistics_end: string;
  days: number;
  top: number;
  property_id: string;
  data_quality: WikiFxDataQuality;
  cache: WikiFxCache;
  items: WikiFxTopic[];
}

export interface WikiFxAdoptInput {
  article_id: string;
  language: string;
  days?: number;
  manual?: boolean;
}

export interface WikiFxAdoptResponse {
  content_item_id: string;
  status: string;
  created_at: string;
}

export interface WikiFxManualArticle {
  id: string;
  language: string;
  article_id: string;
  title: string;
  url: string | null;
  content: string | null;
  first_image_url: string | null;
  content_status: string | null;
  content_message: string | null;
}

export interface WikiFxFetchByUrlResponse {
  origin: "cache" | "upstream";
  article: WikiFxManualArticle;
  cache_ttl_seconds: number;
}

export interface UserAccountLink {
  userId: string;
  canEdit: boolean;
  canPublish: boolean;
  canReview: boolean;
  user?: { id: string; name: string };
}

export interface Account {
  id: string;
  platform: string;
  name: string;
  postizIntegrationId: string;
  market?: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  note?: string | null;
  status: string;
  lastSyncedAt?: string | null;
  userLinks?: UserAccountLink[];
}

export interface RoutingRule {
  id: string;
  language: string;
  contentType: string;
  platform: string;
  accountId: string;
  priority: number;
  enabled: boolean;
  account?: Account;
}

export interface SourceDatabase {
  id: string;
  notionDatabaseId: string;
  language: string;
  tableType: string;
  enabled: boolean;
  lastPolledAt?: string | null;
}

export interface ConsoleUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface InstagramPreview {
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
}

export interface PromptConfig {
  id: string | null;
  version: number;
  systemPrompt: string;
  generationTemplate: string;
  revisionTemplate: string;
  platformRules: Record<string, string>;
  typeTones: Record<string, string>;
}

export interface PromptVersion extends Omit<PromptConfig, "id"> {
  id: string;
  active: boolean;
  changeNote?: string | null;
  activatedAt?: string | null;
  createdAt: string;
}

export interface PromptVersionsResponse {
  active: PromptConfig;
  defaults: PromptConfig;
  versions: PromptVersion[];
}

export interface Stats {
  byStatus: Array<{ status: string; _count: number }>;
  jobsByPlatform: Array<{ platform: string; status: string; _count: number }>;
  recentFailures: Array<
    PublishJobRow & { contentItem: { title: string; language: string } }
  >;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 服务端组件直连 API：附加管理密钥与当前用户身份头（动态 import 避免打进客户端包）
  const serverHeaders: Record<string, string> = {};
  if (isServer) {
    if (process.env.ADMIN_API_KEY) {
      serverHeaders["x-admin-key"] = process.env.ADMIN_API_KEY;
    }
    const { auth } = await import("@/auth");
    const session = await auth();
    const user = session?.user as { id?: string; role?: string } | undefined;
    if (user) {
      serverHeaders["x-user-id"] = user.id ?? "";
      serverHeaders["x-user-role"] = user.role ?? "operator";
    }
  }
  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...serverHeaders,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `API ${res.status}`;
    try {
      const payload = (await res.json()) as {
        message?: unknown;
        error?: unknown;
      };
      const candidate = payload.message ?? payload.error;
      if (typeof candidate === "string" && candidate.trim()) {
        message = candidate;
      } else if (Array.isArray(candidate)) {
        const first = candidate.find((value): value is string =>
          typeof value === "string" && value.trim().length > 0
        );
        if (first) message = first;
      }
    } catch {
      // Some upstream/proxy failures have no JSON body. Keep the safe status message.
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchContents(params: ContentListParams = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter((kv): kv is [string, string] =>
      Boolean(kv[1]),
    ),
  ).toString();
  return request<ContentItem[]>(`/v1/contents${qs ? `?${qs}` : ""}`);
}

export const fetchContent = (id: string) =>
  request<ContentItem>(`/v1/contents/${id}`);
export const fetchJobs = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter((kv): kv is [string, string] =>
      Boolean(kv[1])
    ),
  ).toString();
  return request<PublishJobRow[]>(`/v1/jobs${qs ? `?${qs}` : ""}`);
};
export const fetchAccounts = () => request<Account[]>("/v1/accounts");
export const fetchRouting = () => request<RoutingRule[]>("/v1/routing");
export const fetchSources = () => request<SourceDatabase[]>("/v1/sources");
export const fetchStats = () => request<Stats>("/v1/stats");
export const fetchUsers = () => request<ConsoleUser[]>("/v1/users");
export const fetchPrompts = () =>
  request<PromptVersionsResponse>("/v1/prompts");

export function fetchWikiFxTopics(
  params: { days?: number; top?: number } = {},
) {
  const qs = new URLSearchParams();
  if (params.days !== undefined) qs.set("days", String(params.days));
  if (params.top !== undefined) qs.set("top", String(params.top));
  const query = qs.toString();
  return request<WikiFxTopicsResponse>(
    `/v1/topics/wikifx${query ? `?${query}` : ""}`,
  );
}

export const adoptWikiFxTopic = (input: WikiFxAdoptInput) =>
  request<WikiFxAdoptResponse>("/v1/topics/wikifx/adopt", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const fetchWikiFxArticleByUrl = (
  url: string,
  force = false,
) =>
  request<WikiFxFetchByUrlResponse>("/v1/topics/wikifx/fetch-by-url", {
    method: "POST",
    body: JSON.stringify({ url, force }),
  });

export const previewInstagramImage = (url: string) =>
  request<InstagramPreview>("/v1/media/instagram-preview", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
export const postAction = (path: string, body?: object) =>
  request<unknown>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
export const patchAction = (path: string, body: object) =>
  request<unknown>(path, { method: "PATCH", body: JSON.stringify(body) });
export const putAction = (path: string, body: object) =>
  request<unknown>(path, { method: "PUT", body: JSON.stringify(body) });
export const deleteAction = (path: string) =>
  request<unknown>(path, { method: "DELETE" });
