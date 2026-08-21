"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CalendarDays,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutList,
  ListChecks,
  LogOut,
  Menu,
  Route,
  Send,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useState } from "react";

const NAV = [
  { href: "/dashboard", label: "总览", icon: LayoutDashboard },
  { href: "/topics", label: "热点选题", icon: Sparkles },
  { href: "/queue", label: "内容队列", icon: LayoutList },
  { href: "/review", label: "审核工作台", icon: ListChecks },
  { href: "/records", label: "发布记录", icon: Send },
  { href: "/routing", label: "路由矩阵", icon: Route, adminOnly: true },
  { href: "/accounts", label: "账号健康", icon: Users },
  { href: "/calendar", label: "发布日历", icon: CalendarDays },
  { href: "/media-tools", label: "媒体工具", icon: ImageIcon },
  { href: "/prompts", label: "Prompt 管理", icon: FileText, adminOnly: true },
  { href: "/settings", label: "设置", icon: Settings, adminOnly: true },
];

export function Sidebar({
  userName,
  userRole,
}: {
  userName?: string;
  userRole?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((item) => !item.adminOnly || userRole === "admin");

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-card md:min-h-dvh md:w-52 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
        <Link
          href="/dashboard"
          className="text-base font-bold text-primary"
          onClick={() => setOpen(false)}
        >
          社媒发布控制台
        </Link>
        <button
          type="button"
          aria-label={open ? "收起导航菜单" : "打开导航菜单"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border text-muted-foreground active:scale-[0.96] hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
        >
          {open
            ? <X className="size-5" aria-hidden />
            : <Menu className="size-5" aria-hidden />}
        </button>
      </div>
      <nav
        className={clsx(
          "flex-1 space-y-1 px-2 pb-2 md:block",
          open ? "block" : "hidden",
        )}
      >
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={clsx(
              "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              pathname === href || pathname.startsWith(`${href}/`)
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div
        className={clsx(
          "border-t border-border px-4 py-3",
          !open && "hidden md:block",
        )}
      >
        <p
          className="break-words text-xs text-muted-foreground"
          title={userName}
        >
          {userName}
          {userRole === "admin" && (
            <span className="ml-1 text-primary">· 管理员</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground active:scale-[0.98] hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <LogOut className="size-3.5" aria-hidden />
          退出登录
        </button>
      </div>
    </aside>
  );
}
