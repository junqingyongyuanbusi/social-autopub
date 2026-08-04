import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// 浏览器 → 本代理 → API：ADMIN_API_KEY 只存在于 console 服务端，不下发浏览器
const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (path[0] === "v1" && path[1] === "prompts") {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role !== "admin")
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = `${API}/${path.join("/")}${req.nextUrl.search}`;
  const res = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": process.env.ADMIN_API_KEY ?? "",
    },
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.text(),
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
