"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { accountNav, canApplyAsCreator, creatorNav, isApprovedCreator, type NavItem } from "@/components/account-nav";
import { PageHeader } from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";

export default function MePage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const sessionUser = user ? { role: user.role ?? undefined, creatorStatus: user.creatorStatus ?? undefined, status: user.status ?? undefined } : null;
  const approvedCreator = isApprovedCreator(sessionUser);

  if (!user) {
    return <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <PageHeader title="我的" subtitle="登录后管理收藏、订单和关注内容。" />
      <div className="glass rounded-3xl p-6">
        <p className="font-bold">登录后查看你的账户菜单。</p>
        <Link href="/sign-in?callbackUrl=%2Fme" className="brand-gradient mt-5 inline-flex rounded-full px-5 py-3 text-sm font-bold text-white">登录</Link>
      </div>
    </div>;
  }

  return <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
    <PageHeader title="我的" subtitle={`你好，${user.name}。`} />
    {approvedCreator && <MenuSection title="博主空间" items={creatorNav} />}
    <MenuSection title="账户" items={accountNav} />
    {canApplyAsCreator(sessionUser) && <Link href="/become-creator" className="brand-gradient mt-6 inline-flex rounded-full px-5 py-3 text-sm font-bold text-white">成为博主</Link>}
    <button onClick={() => authClient.signOut().then(() => window.location.assign("/"))} className="glass mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-bold text-coral"><LogOut size={18} />退出登入</button>
  </div>;
}

function MenuSection({ title, items }: { title: string; items: NavItem[] }) {
  return <section className="mt-7">
    <h2 className="mb-3 text-lg font-black">{title}</h2>
    <div className="glass overflow-hidden rounded-3xl">
      {items.map((item) => <Link key={item.href} href={item.href} className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 text-sm font-bold last:border-b-0"><span>{item.label}</span><span aria-hidden>›</span></Link>)}
    </div>
  </section>;
}
