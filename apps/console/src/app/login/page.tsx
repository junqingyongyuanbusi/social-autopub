'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await signIn('credentials', { email, password, redirect: false });
    if (res?.error) {
      setError('邮箱或密码不正确');
      setBusy(false);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-lg font-bold text-primary">社媒发布控制台</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">请登录后继续</p>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-muted-foreground">邮箱</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="mb-2 block text-sm">
          <span className="mb-1 block text-muted-foreground">密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 focus:border-primary focus:outline-none"
          />
        </label>

        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
