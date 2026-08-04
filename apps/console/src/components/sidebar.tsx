"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CalendarDays,
  FilePenLine,
  LayoutDashboard,
  LayoutList,
  ListChecks,
  LogOut,
  Route,
  Send,
  Settings,
  Users,
} from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard", label: "总览", icon: LayoutDashboard },
  { href: "/queue", label: "内容队列", icon: LayoutList },
  { href: "/review", label: "审核工作台", icon: ListChecks },
  { href: "/records", label: "发布记录", icon: Send },
  { href: "/routing", label: "路由矩阵", icon: Route },
  { href: "/accounts", label: "账号健康", icon: Users },
  { href: "/calendar", label: "发布日历", icon: CalendarDays },
  {
    href: "/prompts",
    label: "Prompt 管理",
    icon: FilePenLine,
    adminOnly: true,
  },
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar({
  userName,
  userRole,
}: {
  userName?: string;
  userRole?: string;
}) {
  const pathname = usePathname();
  const items = NAV.filter(
    (item) => !("adminOnly" in item) || userRole === "admin",
  );
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-4 py-5 text-base font-bold text-primary">
        社媒发布控制台
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith(href)
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-3">
        <p className="truncate text-xs text-muted-foreground" title={userName}>
          {userName}
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
        >
          <LogOut className="size-3.5" aria-hidden />
          退出登录
        </button>
      </div>
    </aside>
  );
}
