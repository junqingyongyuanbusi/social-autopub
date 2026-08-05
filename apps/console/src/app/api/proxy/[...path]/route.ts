import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

// 浏览器 → 本代理 → API：ADMIN_API_KEY 只存在于 console 服务端，不下发浏览器。
// 同时附加当前登录用户身份头（x-user-id / x-user-role），API 侧据此做账号级过滤与动作权限
const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// 双保险：这些前缀的写操作在代理层就拒绝非 admin（API 层还有 AdminRoleGuard）
const ADMIN_WRITE_PREFIXES = ['v1/prompts', 'v1/routing', 'v1/sources', 'v1/users'];

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const role = user?.role ?? 'operator';
  const { path } = await params;
  const joined = path.join('/');

  if (req.method !== 'GET' && role !== 'admin' && ADMIN_WRITE_PREFIXES.some((p) => joined.startsWith(p))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const res = await fetch(`${API}/${joined}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': process.env.ADMIN_API_KEY ?? '',
      'x-user-id': user?.id ?? '',
      'x-user-role': role,
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE };
