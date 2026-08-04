import { NextResponse } from "next/server";
import { auth } from "@/auth";

// 全站登录闸门：未登录页面跳 /login；代理接口直接 401（防止绕过页面直连代理）
export default auth((req) => {
  if (req.auth) {
    const role = (req.auth.user as { role?: string } | undefined)?.role;
    if (req.nextUrl.pathname.startsWith("/prompts") && role !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
    }
    return NextResponse.next();
  }
  if (req.nextUrl.pathname.startsWith("/api/proxy")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
});

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
