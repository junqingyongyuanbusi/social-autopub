import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// 登录态只存在于 console 层（JWT cookie）；密码校验委托给 api 的 /v1/auth/verify
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Railway 反代后必需
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const res = await fetch(`${API}/v1/auth/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': process.env.ADMIN_API_KEY ?? '',
          },
          body: JSON.stringify({ email: credentials?.email, password: credentials?.password }),
        });
        if (!res.ok) return null;
        const user = (await res.json()) as { id: string; email: string; name: string; role: string };
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
});
