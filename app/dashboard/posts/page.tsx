"use client";

import Link from "next/link";
import { Edit3, Eye, Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";
import { getAllPosts, useDemoStore } from "@/lib/store";

export default function PostsDashboard(){
  const posts=getAllPosts(useDemoStore(s=>s.customPosts)).filter(p=>p.creatorId==="c1");
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><PageHeader title="作品管理" subtitle="管理已发布内容与草稿。" action={<Link href="/dashboard/posts/new" className="brand-gradient flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white"><Plus size={17}/>发布作品</Link>}/><DashboardNav/>
    <div className="glass overflow-hidden rounded-[30px]"><div className="hidden grid-cols-[1fr_120px_120px_80px] border-b border-[var(--line)] px-6 py-4 text-xs font-bold uppercase tracking-wider muted sm:grid"><span>作品</span><span>权限</span><span>数据</span><span/></div>{posts.map(p=><div key={p.id} className="flex flex-col gap-4 border-b border-[var(--line)] p-5 last:border-0 sm:grid sm:grid-cols-[1fr_120px_120px_80px] sm:items-center sm:px-6"><div className="flex items-center gap-4"><div className={`h-16 w-24 shrink-0 rounded-2xl ${p.cover}`}/><div><p className="font-black">{p.title}</p><p className="text-xs muted">{p.createdAt} · 已发布</p></div></div><span className="w-fit rounded-full bg-black/5 px-3 py-1 text-xs font-bold dark:bg-white/5">{p.visibility==="free"?"公开":p.visibility==="members"?"会员":"单次购买"}</span><span className="flex items-center gap-1 text-sm muted"><Eye size={15}/>{(p.likes*8).toLocaleString()}</span><button className="rounded-xl border border-[var(--line)] p-2 muted"><Edit3 size={16}/></button></div>)}</div>
  </div>;
}
