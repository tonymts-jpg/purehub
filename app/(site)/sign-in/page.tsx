"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { LogIn } from "lucide-react";
import { authClient } from "@/lib/auth-client";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (result.error) return setError(result.error.message ?? "登入失敗，請檢查 Email 與密碼。");
    const callback = searchParams.get("callbackUrl");
    router.push(callback?.startsWith("/") ? callback : "/");
    router.refresh();
  }

  return <form onSubmit={submit} className="glass w-full max-w-md rounded-[28px] p-6 shadow-soft sm:p-8">
    <div className="mb-7"><span className="brand-gradient grid h-11 w-11 place-items-center rounded-2xl text-white"><LogIn size={20}/></span><h1 className="mt-5 text-3xl font-black">登入 PureHub</h1><p className="mt-2 text-sm muted">繼續管理會員、收藏與創作者收入。</p></div>
    <label className="block text-sm font-bold">Email<input type="email" autoComplete="email" required value={email} onChange={(event)=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/></label>
    <label className="mt-4 block text-sm font-bold">密碼<input type="password" autoComplete="current-password" required minLength={12} value={password} onChange={(event)=>setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/></label>
    {error&&<p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
    <button disabled={loading} className="brand-gradient mt-6 w-full rounded-xl py-3 font-bold text-white disabled:opacity-60">{loading?"登入中...":"登入"}</button>
    <p className="mt-5 text-center text-sm muted">還沒有帳戶？ <Link href="/register" className="font-bold text-violet">建立帳戶</Link></p>
  </form>;
}

export default function SignInPage() {
  return <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10"><Suspense><SignInForm/></Suspense></main>;
}
