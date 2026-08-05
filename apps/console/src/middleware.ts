import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// admin 专属页面：operator 访问重定向回总览
const ADMIN_PAGES = ['/prompts', '/settings', '/routing'];

// 全站登录闸门：未登录页面跳 /login；代理接口直接 401
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (!req.auth) {
    if (pathname.startsWith('/api/proxy')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
  }
  const role = (req.auth.user as { role?: string } | undefined)?.role;
  if (role !== 'admin' && ADMIN_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
