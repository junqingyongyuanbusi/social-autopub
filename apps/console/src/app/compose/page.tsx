"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Image as ImageIcon,
  LoaderCircle,
  Send,
  Upload,
  Check,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ComposeAccountOption,
  ComposeMediaRef,
  ComposeMediaSlot,
  ComposeOptions,
  ComposePublishResult,
  MediaUploadResult,
  fetchComposeOptions,
  publishCompose,
  uploadComposeMedia,
} from "@/lib/api";

const PLATFORM_ORDER = ["instagram", "facebook", "x"];

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
};

interface UploadedSlot {
  media: MediaUploadResult;
  previewUrl: string;
  filename: string;
}

type MediaState = Partial<Record<ComposeMediaSlot, UploadedSlot>>;

const toMediaRef = (uploaded: MediaUploadResult): ComposeMediaRef => ({
  id: uploaded.id,
  path: uploaded.path,
});

type PublishMode = "schedule" | "now" | "queue" | "draft";

function PlatformIcon({
  platform,
  className = "size-5",
}: {
  platform: string;
  className?: string;
}) {
  switch (platform.toLowerCase()) {
    case "x":
    case "twitter":
      return (
        <div
          className={`${className} flex items-center justify-center rounded-lg bg-black text-white shrink-0`}
          aria-hidden
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </div>
      );
    case "instagram":
      return (
        <div
          className={`${className} flex items-center justify-center rounded-lg bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white shrink-0 shadow-sm`}
          aria-hidden
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
          </svg>
        </div>
      );
    case "facebook":
      return (
        <div
          className={`${className} flex items-center justify-center rounded-lg bg-[#1877F2] text-white shrink-0 shadow-sm`}
          aria-hidden
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
        </div>
      );
    default:
      return (
        <div
          className={`${className} flex items-center justify-center rounded-lg bg-slate-200 text-slate-700 shrink-0 font-bold text-xs`}
          aria-hidden
        >
          {platform.slice(0, 1).toUpperCase()}
        </div>
      );
  }
}

const COMMON_TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Auckland",
  "UTC",
];

function formatTimezoneOption(tz: string): string {
  try {
    const now = new Date();
    const shortTz =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    const offsetStr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "longOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${tz} (${shortTz}) (${offsetStr || "UTC"})`;
  } catch {
    return tz;
  }
}

function zonedTimeToUtc(dateTimeStr: string, timeZone: string): Date | null {
  if (!dateTimeStr) return null;
  const [datePart, timePart] = dateTimeStr.split("T");
  if (!datePart || !timePart) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return null;

  try {
    const utcGuess = new Date(Date.UTC(y, m - 1, d, h, min));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcGuess);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const tzDate = new Date(
      Date.UTC(
        +map.year,
        +map.month - 1,
        +map.day,
        +map.hour % 24,
        +map.minute,
        +map.second,
      ),
    );
    const diff = tzDate.getTime() - utcGuess.getTime();
    return new Date(utcGuess.getTime() - diff);
  } catch {
    return null;
  }
}

// 撰写发布：自己写文案、上传两个尺寸的图、选择已授权账号后直接发布。
// 不经过 LLM 生成，也不进入审核工作台。
export default function ComposePage() {
  const [options, setOptions] = useState<ComposeOptions | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaState>({});
  const [uploading, setUploading] = useState<ComposeMediaSlot | "">("");
  const [publishMode, setPublishMode] = useState<PublishMode>("schedule");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [timezone, setTimezone] = useState(() => {
    try {
      return (
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
      );
    } catch {
      return "America/Los_Angeles";
    }
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<
    { kind: "error" | "success"; text: string } | null
  >(null);
  const [result, setResult] = useState<ComposePublishResult | null>(null);
  const instagramInputRef = useRef<HTMLInputElement>(null);
  const landscapeInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchComposeOptions()
      .then((data) => {
        setOptions(data);
        setLoadError("");
      })
      .catch(() => setLoadError("加载可选账号失败，请刷新重试"));
  }, []);

  useEffect(load, [load]);

  const selectedAccounts = useMemo(
    () =>
      (options?.accounts ?? []).filter((account) => selected.has(account.id)),
    [options, selected],
  );

  const platforms = useMemo(
    () =>
      PLATFORM_ORDER.filter((platform) =>
        selectedAccounts.some((account) => account.platform === platform),
      ),
    [selectedAccounts],
  );

  // 释放本地预览 URL，避免切换图片或离开页面时泄漏
  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);
  useEffect(
    () => () => {
      Object.values(mediaRef.current).forEach((slot) => {
        if (slot) URL.revokeObjectURL(slot.previewUrl);
      });
    },
    [],
  );

  const accountsByPlatform = useMemo(() => {
    const groups = new Map<string, ComposeAccountOption[]>();
    for (const account of options?.accounts ?? []) {
      const list = groups.get(account.platform) ?? [];
      list.push(account);
      groups.set(account.platform, list);
    }
    return PLATFORM_ORDER.flatMap((platform) => {
      const list = groups.get(platform);
      return list ? [[platform, list] as const] : [];
    });
  }, [options]);

  const timezoneList = useMemo(() => {
    if (COMMON_TIMEZONES.includes(timezone)) {
      return COMMON_TIMEZONES;
    }
    return [timezone, ...COMMON_TIMEZONES];
  }, [timezone]);

  const needsInstagram = platforms.includes("instagram");
  const needsLandscape = platforms.includes("facebook") || platforms.includes("x");

  const toggleAccount = (accountId: string) => {
    setResult(null);
    setNotice(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    slot: ComposeMediaSlot,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    setUploading(slot);
    setNotice(null);
    try {
      const uploaded = await uploadComposeMedia(file, slot);
      const previewUrl = URL.createObjectURL(file);
      setMedia((current) => {
        const previous = current[slot];
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return {
          ...current,
          [slot]: { media: uploaded, previewUrl, filename: file.name },
        };
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "图片上传失败，请重试",
      });
    } finally {
      setUploading("");
    }
  };

  const removeSlotMedia = (slot: ComposeMediaSlot) => {
    setMedia((current) => {
      const previous = current[slot];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      const next = { ...current };
      delete next[slot];
      return next;
    });
  };

  const calculatedUtcDate = useMemo(() => {
    if (publishMode !== "schedule" || !scheduleDateTime) return null;
    return zonedTimeToUtc(scheduleDateTime, timezone);
  }, [publishMode, scheduleDateTime, timezone]);

  // 未满足的条件会显示在按钮旁，避免用户对着灰按钮猜原因
  const blockingReason = (() => {
    if (!options) return "正在加载可选账号…";
    if (result) return "";
    if (!selectedAccounts.length) return "请选择至少一个发布账号";
    if (!text.trim()) return "请输入内容";
    if (needsInstagram && !media.instagram_4x5) {
      return "已包含 Instagram 账号，请上传 4:5 图片";
    }
    if (needsLandscape && !media.landscape_16x9) {
      return "已包含 Facebook 或 X 账号，请上传 16:9 图片";
    }
    if (publishMode === "schedule") {
      if (!scheduleDateTime) {
        return "请设置排期日期和时间";
      }
      if (calculatedUtcDate && calculatedUtcDate.getTime() <= Date.now()) {
        return "排期时间必须晚于当前时间";
      }
    }
    return "";
  })();

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      // 语言自动从已选账号的市场提取，无需人工填写
      const autoLanguage =
        selectedAccounts.find((account) => account.market)?.market?.toLowerCase() ||
        "en";

      const payload = {
        language: autoLanguage,
        text: text.trim(),
        accounts: selectedAccounts.map((account) => ({
          platform: account.platform,
          accountId: account.id,
        })),
        media: {
          ...(needsInstagram && media.instagram_4x5
            ? { instagram: toMediaRef(media.instagram_4x5.media) }
            : {}),
          ...(needsLandscape && media.landscape_16x9
            ? { landscape: toMediaRef(media.landscape_16x9.media) }
            : {}),
        },
        publishAt:
          publishMode === "schedule" && calculatedUtcDate
            ? calculatedUtcDate.toISOString()
            : null,
      };
      setResult(await publishCompose(payload));
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "发布提交失败，请重试",
      });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    Object.values(media).forEach((slot) => {
      if (slot) URL.revokeObjectURL(slot.previewUrl);
    });
    setMedia({});
    setText("");
    setScheduleDateTime("");
    setResult(null);
    setNotice(null);
  };

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {loadError}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* 顶部 Header */}
      <div className="border-b border-border/80 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Create Post
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          create &amp; publish content
        </p>
      </div>

      {options?.dryRun && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs text-warning-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">当前为 DRY_RUN 模式</p>
            <p className="mt-0.5 opacity-80">
              发布将在 Postiz 侧生成草稿（Draft），不会直接推送至社媒正式外网。
            </p>
          </div>
        </div>
      )}

      {/* 双栏布局：左侧 content + add media，右侧 platforms + publishing */}
      <div className="grid items-start gap-8 lg:grid-cols-12">
        {/* 左侧：content & media */}
        <section className="space-y-6 lg:col-span-7">
          {/* 文案输入区 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                content
              </span>
            </div>
            <div className="relative rounded-xl border border-slate-200 bg-card shadow-sm transition-all focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
              <textarea
                id="compose-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="what's on your mind..."
                className="w-full resize-y rounded-xl bg-transparent p-4 text-sm leading-relaxed text-foreground placeholder:text-slate-400 focus:outline-none"
              />
              <div className="flex items-center justify-end px-4 pb-3">
                <span className="text-xs tabular-nums text-slate-400">
                  {text.length} chars
                </span>
              </div>
            </div>
          </div>

          {/* 媒体上传区：支持多尺寸 (IG 4:5 与 FB/X 16:9) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                media (aspect ratios)
              </span>
              <span className="text-[11px] text-slate-400">
                IG 适配 4:5 · FB/X 适配 16:9
              </span>
            </div>

            {/* 隐藏的真实文件 input */}
            <input
              ref={instagramInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handleUpload(e, "instagram_4x5")}
            />
            <input
              ref={landscapeInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handleUpload(e, "landscape_16x9")}
            />

            <div className="grid gap-3.5 sm:grid-cols-2">
              {/* 插槽 1: Instagram 4:5 */}
              <div className="relative">
                {media.instagram_4x5 ? (
                  <div className="group relative flex items-center gap-3.5 rounded-xl border border-slate-200 bg-card p-3 shadow-sm transition-all hover:border-slate-300">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={media.instagram_4x5.previewUrl}
                        alt="Instagram 4:5 preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <PlatformIcon platform="instagram" className="size-4" />
                        <span>Instagram (4:5)</span>
                      </div>
                      <p className="mt-1 truncate text-slate-400">
                        {media.instagram_4x5.filename}
                      </p>
                      <p className="mt-0.5 tabular-nums text-slate-400">
                        {media.instagram_4x5.media.width} ×{" "}
                        {media.instagram_4x5.media.height} px
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlotMedia("instagram_4x5")}
                      className="rounded-lg p-1 text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                      title="移除此图片"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => instagramInputRef.current?.click()}
                    disabled={uploading === "instagram_4x5"}
                    className={`flex min-h-[100px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-card p-4 text-center transition-all hover:border-slate-300 hover:bg-slate-50/50 ${
                      needsInstagram
                        ? "ring-1 ring-primary/20"
                        : "opacity-75"
                    }`}
                  >
                    {uploading === "instagram_4x5" ? (
                      <LoaderCircle
                        className="size-5 animate-spin text-slate-400"
                        aria-hidden
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <PlatformIcon platform="instagram" className="size-4" />
                        <span>+ Add 4:5 media</span>
                      </div>
                    )}
                    <span className="mt-1 text-[11px] text-slate-400">
                      Instagram 专享 · 1080×1350
                    </span>
                  </button>
                )}
              </div>

              {/* 插槽 2: Facebook & X 16:9 */}
              <div className="relative">
                {media.landscape_16x9 ? (
                  <div className="group relative flex items-center gap-3.5 rounded-xl border border-slate-200 bg-card p-3 shadow-sm transition-all hover:border-slate-300">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={media.landscape_16x9.previewUrl}
                        alt="Facebook/X 16:9 preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <PlatformIcon platform="x" className="size-4" />
                        <PlatformIcon platform="facebook" className="size-4" />
                        <span>FB &amp; X (16:9)</span>
                      </div>
                      <p className="mt-1 truncate text-slate-400">
                        {media.landscape_16x9.filename}
                      </p>
                      <p className="mt-0.5 tabular-nums text-slate-400">
                        {media.landscape_16x9.media.width} ×{" "}
                        {media.landscape_16x9.media.height} px
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlotMedia("landscape_16x9")}
                      className="rounded-lg p-1 text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                      title="移除此图片"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => landscapeInputRef.current?.click()}
                    disabled={uploading === "landscape_16x9"}
                    className={`flex min-h-[100px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-card p-4 text-center transition-all hover:border-slate-300 hover:bg-slate-50/50 ${
                      needsLandscape
                        ? "ring-1 ring-primary/20"
                        : "opacity-75"
                    }`}
                  >
                    {uploading === "landscape_16x9" ? (
                      <LoaderCircle
                        className="size-5 animate-spin text-slate-400"
                        aria-hidden
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <PlatformIcon platform="x" className="size-4" />
                        <PlatformIcon platform="facebook" className="size-4" />
                        <span>+ Add 16:9 media</span>
                      </div>
                    )}
                    <span className="mt-1 text-[11px] text-slate-400">
                      Facebook &amp; X 共享 · 1200×675
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：platforms (Zernio 方块卡片选择) & publishing */}
        <section className="space-y-6 lg:col-span-5">
          {/* 账号方块选择区：对齐 Zernio 风格，图标+账号 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                platforms
              </span>
              <span className="text-xs text-slate-400">
                {selectedAccounts.length} selected
              </span>
            </div>

            {!options?.accounts || options.accounts.length === 0 ? (
              /* 类似截图中的无账号空状态卡片 */
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-card/60 p-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Plus className="size-5" aria-hidden />
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  no connected accounts
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  connect accounts to your profile first
                </p>
                <Link
                  href="/accounts"
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  前往账号健康绑定
                </Link>
              </div>
            ) : (
              /* 方块网格：图标加账号，点击整块选中/取消 */
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2">
                {options.accounts.map((account) => {
                  const isSelected = selected.has(account.id);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => toggleAccount(account.id)}
                      className={`group relative flex items-center gap-2.5 rounded-xl p-3 text-left transition-all ${
                        isSelected
                          ? "border-2 border-slate-900 bg-slate-50/80 shadow-sm ring-1 ring-slate-900/10"
                          : "border border-slate-200 bg-card hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <PlatformIcon
                        platform={account.platform}
                        className="size-8"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {account.name}
                        </p>
                        <p className="text-[11px] capitalize text-slate-400">
                          {PLATFORM_LABEL[account.platform] ?? account.platform}
                          {account.market ? ` · ${account.market}` : ""}
                        </p>
                      </div>
                      {/* 选中与未选中指示器 */}
                      <div
                        className={`flex size-4 shrink-0 items-center justify-center rounded-full transition-all ${
                          isSelected
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 group-hover:border-slate-400"
                        }`}
                      >
                        {isSelected && (
                          <Check className="size-2.5" strokeWidth={3} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* publishing 控制区：完全对齐截图 */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                publishing
              </span>
              {publishMode === "schedule" && calculatedUtcDate && (
                <span className="text-[11px] tabular-nums text-slate-400">
                  UTC: {calculatedUtcDate.toISOString().replace(".000Z", "Z")}
                </span>
              )}
            </div>

            {/* 分段按钮：Schedule / Now / Queue / Draft */}
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-slate-200/90 bg-slate-100/90 p-1">
              {(
                [
                  { id: "schedule", label: "Schedule" },
                  { id: "now", label: "Now" },
                  { id: "queue", label: "Queue" },
                  { id: "draft", label: "Draft" },
                ] as const
              ).map((tab) => {
                const active = publishMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPublishMode(tab.id)}
                    className={`min-h-8 rounded-lg text-xs transition-all ${
                      active
                        ? "bg-white font-semibold text-slate-900 shadow-sm"
                        : "font-medium text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Schedule 展开的参数输入区 */}
            {publishMode === "schedule" && (
              <div className="grid gap-3 pt-1 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="schedule-datetime"
                    className="mb-1 block text-xs font-medium text-slate-600"
                  >
                    date &amp; time
                  </label>
                  <input
                    id="schedule-datetime"
                    type="datetime-local"
                    value={scheduleDateTime}
                    onChange={(e) => setScheduleDateTime(e.target.value)}
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-card px-3 text-xs text-foreground focus:border-slate-400 focus:outline-none focus:ring-0"
                  />
                </div>
                <div>
                  <label
                    htmlFor="schedule-timezone"
                    className="mb-1 block text-xs font-medium text-slate-600"
                  >
                    timezone
                  </label>
                  <select
                    id="schedule-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-card px-3 text-xs text-foreground focus:border-slate-400 focus:outline-none focus:ring-0"
                  >
                    {timezoneList.map((tz) => (
                      <option key={tz} value={tz}>
                        {formatTimezoneOption(tz)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {publishMode === "now" && (
              <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                点击发布后，任务将直接提交至 Postiz 立即发布。
              </p>
            )}
            {publishMode === "queue" && (
              <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                任务将放入发送队列，根据系统默认发布速率依次发送。
              </p>
            )}
            {publishMode === "draft" && (
              <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                将文案与媒体同步至 Postiz 保存为草稿，供后续继续编辑。
              </p>
            )}

            {/* 提交主按钮 */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || Boolean(blockingReason)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : publishMode === "schedule" ? (
                  <CalendarClock className="size-4" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {busy
                  ? "Submitting…"
                  : publishMode === "schedule"
                    ? "Schedule Post"
                    : publishMode === "draft"
                      ? "Save Draft"
                      : publishMode === "queue"
                        ? "Add to Queue"
                        : "Publish Now"}
              </button>

              {blockingReason && (
                <p className="mt-2 text-center text-xs text-amber-600">
                  {blockingReason}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-lg p-3 text-sm ${
            notice.kind === "error"
              ? "border border-destructive/20 bg-destructive/10 text-destructive"
              : "border border-success/20 bg-success/10 text-success"
          }`}
        >
          {notice.text}
        </p>
      )}

      {result ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-success"
              aria-hidden
            />
            <div className="text-sm">
              <p className="font-semibold text-foreground">
                {publishMode === "schedule"
                  ? "已排期提交"
                  : "已提交，正在发布"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {publishMode === "schedule" && calculatedUtcDate
                  ? `任务已排期至 ${scheduleDateTime.replace("T", " ")} (${timezone})。`
                  : "发布任务已成功提交至发布引擎。"}
                目标平台：
                {result.platforms
                  .map((platform) => PLATFORM_LABEL[platform] ?? platform)
                  .join("、")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {publishMode === "schedule" && (
                  <Link
                    href="/calendar"
                    className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    前往发布日历
                  </Link>
                )}
                <Link
                  href="/records"
                  className="inline-flex min-h-9 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:border-slate-400"
                >
                  查看发布记录
                </Link>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex min-h-9 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:border-slate-400"
                >
                  再写一条
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
