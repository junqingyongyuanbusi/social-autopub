"use client";

import { useState } from "react";
import {
  BarChart3,
  Bookmark,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";

// 预览为本地模拟：以下阈值为平台当前展示行为的近似常量，集中在此便于调整
const X_TEXT_LIMIT = 280; // 时间线折叠为 "Show more" 的阈值，非发布上限（发布上限由账号 textLimit 决定）
const INSTAGRAM_CAPTION_LIMIT = 125;
const FACEBOOK_CAPTION_LIMIT = 250;

const PLATFORM_ORDER = ["instagram", "facebook", "x"];

const PLATFORM_LABEL: Record<string, string> = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

interface PreviewAccount {
  id: string;
  name: string;
  platform: string;
  market?: string | null;
}

interface PreviewSlot {
  previewUrl: string;
  filename: string;
  media: { width: number; height: number };
}

export interface PostPreviewProps {
  text: string;
  platforms: string[];
  accounts: PreviewAccount[];
  media: {
    instagram_4x5?: PreviewSlot;
    landscape_16x9?: PreviewSlot;
  };
  scheduledAt?: Date | null;
}

// 头像底色由账号 id 的稳定哈希决定，同一账号颜色恒定
const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
];

function avatarColorClass(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

// console 账号数据暂无平台 profile 字段，展示用 handle 由账号名推导（推断值）
function inferredHandle(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "");
  return normalized ? `@${normalized}` : "@";
}

function formatPreviewTime(scheduledAt?: Date | null): string {
  if (!scheduledAt) return "现在";
  return scheduledAt.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateCaption(
  value: string,
  limit: number,
): { body: string; truncated: boolean } {
  if (value.length <= limit) return { body: value, truncated: false };
  return { body: value.slice(0, limit).trimEnd(), truncated: true };
}

function PreviewAvatar({
  account,
  className = "size-10",
  ring = false,
}: {
  account: PreviewAccount;
  className?: string;
  ring?: boolean;
}) {
  const avatar = (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColorClass(account.id)}`}
      aria-hidden
    >
      {avatarInitial(account.name)}
    </div>
  );
  if (!ring) return avatar;
  return (
    <div className="shrink-0 rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px]">
      <div className="rounded-full bg-white p-[2px]">{avatar}</div>
    </div>
  );
}

function XPreviewCard({
  account,
  text,
  image,
  scheduledAt,
}: {
  account: PreviewAccount;
  text: string;
  image?: PreviewSlot;
  scheduledAt?: Date | null;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <PreviewAvatar account={account} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <span className="font-semibold text-slate-900">{account.name}</span>
            <span className="text-slate-400">{inferredHandle(account.name)}</span>
            <span aria-hidden className="text-slate-300">·</span>
            <span className="text-slate-400">{formatPreviewTime(scheduledAt)}</span>
          </div>
          {text.trim() ? (
            <p
              dir="auto"
              className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900"
            >
              {text}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">正文将显示在这里</p>
          )}
          {image && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt="X 配图预览"
                className="aspect-video w-full object-cover"
              />
            </div>
          )}
          <div
            className="mt-3 flex max-w-xs items-center justify-between text-slate-400"
            aria-hidden
          >
            <MessageCircle className="size-4" />
            <Repeat2 className="size-4" />
            <Heart className="size-4" />
            <BarChart3 className="size-4" />
          </div>
        </div>
      </div>
    </article>
  );
}

function InstagramPreviewCard({
  account,
  text,
  image,
  scheduledAt,
}: {
  account: PreviewAccount;
  text: string;
  image?: PreviewSlot;
  scheduledAt?: Date | null;
}) {
  const caption = truncateCaption(text, INSTAGRAM_CAPTION_LIMIT);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 p-3">
        <PreviewAvatar account={account} className="size-8" ring />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {account.name}
          </p>
          {account.market && (
            <p className="text-[11px] uppercase text-slate-400">
              {account.market}
            </p>
          )}
        </div>
        <MoreHorizontal className="size-4 text-slate-400" aria-hidden />
      </div>
      {image ? (
        <div className="relative aspect-[4/5] overflow-hidden bg-slate-900">
          {/* 底层模糊填充 + 上层 contain：CSS 近似发布侧 sharp 的 4:5 处理（见 instagram-image.service.ts） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.previewUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-[0.5] saturate-[0.7]"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.previewUrl}
            alt="Instagram 配图预览"
            className="relative h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex aspect-[4/5] flex-col items-center justify-center gap-1.5 bg-slate-50 text-xs text-slate-400">
          <ImageIcon className="size-5" aria-hidden />
          IG 发布需要 4:5 图片
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-3.5 text-slate-800" aria-hidden>
          <Heart className="size-5" />
          <MessageCircle className="size-5" />
          <Send className="size-5" />
          <span className="flex-1" />
          <Bookmark className="size-5" />
        </div>
        {text.trim() ? (
          <p dir="auto" className="text-sm leading-relaxed text-slate-900">
            <span className="font-semibold">{inferredHandle(account.name)}&nbsp;</span>
            {caption.body}
            {caption.truncated && <span className="text-slate-400"> … 更多</span>}
          </p>
        ) : (
          <p className="text-sm text-slate-400">文案将显示在这里</p>
        )}
        {scheduledAt && (
          <p className="text-[11px] text-slate-400">
            {formatPreviewTime(scheduledAt)}
          </p>
        )}
      </div>
    </article>
  );
}

function FacebookPreviewCard({
  account,
  text,
  image,
  scheduledAt,
}: {
  account: PreviewAccount;
  text: string;
  image?: PreviewSlot;
  scheduledAt?: Date | null;
}) {
  const caption = truncateCaption(text, FACEBOOK_CAPTION_LIMIT);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 p-3">
        <PreviewAvatar account={account} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {account.name}
          </p>
          <p className="text-[11px] text-slate-400">
            {formatPreviewTime(scheduledAt)}
          </p>
        </div>
        <MoreHorizontal className="size-4 text-slate-400" aria-hidden />
      </div>
      <div className="px-3 pb-3">
        {text.trim() ? (
          <p dir="auto" className="text-sm leading-relaxed text-slate-900">
            {caption.body}
            {caption.truncated && (
              <span className="text-slate-500"> … 查看全部</span>
            )}
          </p>
        ) : (
          <p className="text-sm text-slate-400">正文将显示在这里</p>
        )}
      </div>
      {image && (
        <div className="border-t border-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.previewUrl}
            alt="Facebook 配图预览"
            className="aspect-video w-full object-cover"
          />
        </div>
      )}
      <div
        className="flex items-center justify-around border-t border-slate-100 px-3 py-2 text-slate-500"
        aria-hidden
      >
        <span className="flex items-center gap-1.5 text-xs">
          <ThumbsUp className="size-4" />
          赞
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <MessageCircle className="size-4" />
          评论
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <Share2 className="size-4" />
          分享
        </span>
      </div>
    </article>
  );
}

// 帖子预览：完全由本地状态渲染的 Feed 模拟卡片，不发起任何请求。
// 已知近似：IG 图片以 CSS 模糊填充模拟发布侧 sharp 处理；截断阈值为平台展示行为的近似值；
// X 的 handle 为由账号名推导的展示值。
export function PostPreview({
  text,
  platforms,
  accounts,
  media,
  scheduledAt,
}: PostPreviewProps) {
  const orderedPlatforms = PLATFORM_ORDER.filter((platform) =>
    platforms.includes(platform),
  );
  const [preferredPlatform, setPreferredPlatform] = useState<string>("");
  const currentPlatform = orderedPlatforms.includes(preferredPlatform)
    ? preferredPlatform
    : orderedPlatforms[0] ?? "";
  const currentAccount = accounts.find(
    (account) => account.platform === currentPlatform,
  );

  return (
    <section aria-label="帖子预览" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          preview
        </span>
        <span className="text-[11px] text-slate-400">效果模拟</span>
      </div>

      {orderedPlatforms.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 bg-card/60 p-6 text-center">
          <p className="text-xs font-medium text-slate-600">
            选择账号后可在此预览
          </p>
          <p className="text-[11px] text-slate-400">
            模拟各平台信息流中的展示效果
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 rounded-xl border border-slate-200/90 bg-slate-100/90 p-1">
            {orderedPlatforms.map((platform) => {
              const active = platform === currentPlatform;
              const overflow =
                platform === "x" ? text.length - X_TEXT_LIMIT : 0;
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => setPreferredPlatform(platform)}
                  aria-pressed={active}
                  className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-all ${
                    active
                      ? "bg-white font-semibold text-slate-900 shadow-sm"
                      : "font-medium text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <PlatformIcon platform={platform} className="size-4" />
                  {PLATFORM_LABEL[platform] ?? platform}
                  {overflow > 0 && (
                    <span className="tabular-nums text-destructive">
                      +{overflow}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {currentAccount && currentPlatform === "x" && (
            <XPreviewCard
              account={currentAccount}
              text={text}
              image={media.landscape_16x9}
              scheduledAt={scheduledAt}
            />
          )}
          {currentAccount && currentPlatform === "instagram" && (
            <InstagramPreviewCard
              account={currentAccount}
              text={text}
              image={media.instagram_4x5}
              scheduledAt={scheduledAt}
            />
          )}
          {currentAccount && currentPlatform === "facebook" && (
            <FacebookPreviewCard
              account={currentAccount}
              text={text}
              image={media.landscape_16x9}
              scheduledAt={scheduledAt}
            />
          )}
        </>
      )}
    </section>
  );
}
