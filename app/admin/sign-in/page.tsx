"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { safeCallbackPath } from "@/lib/safe-callback";

function AdminSignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const result = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password
    });

    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "登录失败，请检查邮箱和密码。");
      return;
    }

    router.replace(safeCallbackPath(searchParams.get("callbackUrl"), "/admin"));
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-soft sm:p-8"
      >
        <span className="brand-gradient grid h-12 w-12 place-items-center rounded-2xl text-white">
          <ShieldCheck size={22} />
        </span>
        <h1 className="mt-5 text-3xl font-black">管理员登录</h1>
        <p className="mt-2 text-sm muted">使用已启用的 PureHub 管理员账户登录。</p>

        <label className="mt-7 block text-sm font-bold">
          邮箱
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"
          />
        </label>
        <label className="mt-4 block text-sm font-bold">
          密码
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"
          />
        </label>

        {error ? <p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="brand-gradient mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-white disabled:opacity-60"
        >
          <LogIn size={18} />
          {loading ? "正在登录…" : "登录管理后台"}
        </button>
      </form>
    </main>
  );
}

export default function AdminSignInPage() {
  return <Suspense><AdminSignInForm /></Suspense>;
}
