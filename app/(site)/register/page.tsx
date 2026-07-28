"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", handle: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const handle = form.handle.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(handle)) {
      setLoading(false);
      return setError("Handle 需為 3–30 個小寫英數字或連字號。");
    }
    const result = await authClient.signUp.email({ name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password, handle });
    setLoading(false);
    if (result.error) return setError(result.error.message ?? "註冊失敗，Email 或 handle 可能已被使用。");
    router.push("/");
    router.refresh();
  }

  return <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10"><form onSubmit={submit} className="glass w-full max-w-md rounded-[28px] p-6 shadow-soft sm:p-8">
    <div className="mb-7"><span className="brand-gradient grid h-11 w-11 place-items-center rounded-2xl text-white"><UserPlus size={20}/></span><h1 className="mt-5 text-3xl font-black">建立 PureHub 帳戶</h1><p className="mt-2 text-sm muted">新帳戶預設為粉絲；創作者資格需另行申請。</p></div>
    <label className="block text-sm font-bold">顯示名稱<input required minLength={2} maxLength={60} value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/></label>
    <label className="mt-4 block text-sm font-bold">Handle<input required minLength={3} maxLength={30} placeholder="pure-fan" value={form.handle} onChange={(event)=>setForm({...form,handle:event.target.value})} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/></label>
    <label className="mt-4 block text-sm font-bold">Email<input type="email" autoComplete="email" required value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/></label>
    <label className="mt-4 block text-sm font-bold">密碼<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} onChange={(event)=>setForm({...form,password:event.target.value})} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-4 py-3 outline-none focus:border-violet"/><span className="mt-1 block text-xs font-normal muted">至少 12 個字元</span></label>
    {error&&<p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
    <button disabled={loading} className="brand-gradient mt-6 w-full rounded-xl py-3 font-bold text-white disabled:opacity-60">{loading?"建立中...":"建立帳戶"}</button>
    <p className="mt-5 text-center text-sm muted">已有帳戶？ <Link href="/sign-in" className="font-bold text-violet">登入</Link></p>
  </form></main>;
}
