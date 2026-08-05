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
  language: string;
  contentType: string;
  title: string;
  body?: string;
  status: string;
  publishAt?: string | null;
  createdAt: string;
  generations: Generation[];
  jobs: PublishJobRow[];
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
    if (process.env.ADMIN_API_KEY)
      serverHeaders["x-admin-key"] = process.env.ADMIN_API_KEY;
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
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchContents(params: Record<string, string | undefined> = {}) {
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
      Boolean(kv[1]),
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
