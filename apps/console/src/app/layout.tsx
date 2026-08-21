import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "社媒发布控制台",
};

// 已登录：侧边栏布局；未登录（middleware 只放行 /login）：裸渲染登录页
export default async function RootLayout(
  { children }: { children: React.ReactNode },
) {
  const session = await auth();
  const user = session?.user as {
    name?: string | null;
    email?: string | null;
    role?: string;
  } | undefined;

  return (
    <html lang="zh-CN">
      <body
        className={session
          ? "flex min-h-dvh flex-col font-sans md:flex-row"
          : "font-sans"}
      >
        {session && (
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:ring-2 focus:ring-primary"
          >
            跳到主要内容
          </a>
        )}
        <SessionProvider session={session}>
          {session
            ? (
              <>
                <Sidebar
                  userName={user?.name ?? user?.email ?? ""}
                  userRole={user?.role}
                />
                <main
                  id="main-content"
                  className="min-w-0 flex-1 overflow-x-hidden p-4 md:overflow-x-auto md:p-6"
                >
                  {children}
                </main>
              </>
            )
            : children}
        </SessionProvider>
      </body>
    </html>
  );
}
