import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import { auth } from '@/auth';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: '社媒发布控制台',
};

// 已登录：侧边栏布局；未登录（middleware 只放行 /login）：裸渲染登录页
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user as { name?: string | null; email?: string | null; role?: string } | undefined;

  return (
    <html lang="zh-CN">
      <body className={session ? 'flex min-h-dvh font-sans' : 'font-sans'}>
        <SessionProvider session={session}>
          {session ? (
            <>
              <Sidebar userName={user?.name ?? user?.email ?? ''} userRole={user?.role} />
              <main className="flex-1 overflow-x-auto p-6">{children}</main>
            </>
          ) : (
            children
          )}
        </SessionProvider>
      </body>
    </html>
  );
}
