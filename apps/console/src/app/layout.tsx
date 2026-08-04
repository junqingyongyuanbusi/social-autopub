import type { Metadata } from "next";
import { auth } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "社媒发布控制台",
};

// 已登录：侧边栏布局；未登录（middleware 只放行 /login）：裸渲染登录页
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="zh-CN">
      <body className={session ? "flex min-h-dvh font-sans" : "font-sans"}>
        {session ? (
          <>
            <Sidebar
              userName={session.user?.name ?? session.user?.email ?? ""}
              userRole={(session.user as { role?: string } | undefined)?.role}
            />
            <main className="flex-1 overflow-x-auto p-6">{children}</main>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
