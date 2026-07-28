"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, BadgeCheck } from "lucide-react";
import { PageHeader, Avatar } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import { creators, posts } from "@/lib/data";

export default function ExplorePage() {
  const [q,setQ]=useState(""); const [type,setType]=useState("全部");
  const filtered=useMemo(()=>posts.filter(p=>(p.title+p.excerpt+p.category).toLowerCase().includes(q.toLowerCase())),[q]);
  const foundCreators=creators.filter(c=>(c.name+c.category+c.handle).toLowerCase().includes(q.toLowerCase()));
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <PageHeader title="发现你的下一份热爱" subtitle="探索正在发生的创作，以及它们背后鲜活的人。"/>
    <div className="glass mb-6 flex items-center gap-3 rounded-2xl px-4 py-3"><Search size={20} className="muted"/><input value={q} onChange={e=>setQ(e.target.value)} aria-label="搜索" placeholder="搜索作品、博主或频道" className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]"/></div>
    <div className="mb-8 flex gap-2">{["全部","作品","博主","频道"].map(t=><button key={t} onClick={()=>setType(t)} className={`rounded-full px-4 py-2 text-sm font-bold ${type===t?"bg-ink text-white dark:bg-white dark:text-ink":"glass muted"}`}>{t}</button>)}</div>
    {(type==="全部"||type==="博主")&&<section className="mb-10"><h2 className="mb-4 text-xl font-black">博主</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{foundCreators.map(c=><Link href={`/creator/${c.handle}`} key={c.id} className="glass flex items-center gap-4 rounded-3xl p-5 transition hover:-translate-y-1"><Avatar text={c.avatar}/><div><h3 className="flex items-center gap-1 font-black">{c.name}{c.verified&&<BadgeCheck size={16} className="text-violet"/>}</h3><p className="text-sm muted">{c.category} · {(c.followers/10000).toFixed(1)}万关注</p></div></Link>)}</div></section>}
    {(type==="全部"||type==="作品")&&<section><h2 className="mb-4 text-xl font-black">作品</h2><div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{filtered.map(p=><PostCard key={p.id} post={p}/>)}</div></section>}
    {((type==="作品"&&filtered.length===0)||(type==="博主"&&foundCreators.length===0))&&<div className="glass rounded-3xl py-20 text-center"><Search className="mx-auto mb-4 muted"/><h3 className="font-black">没有找到相关结果</h3><p className="mt-2 text-sm muted">换个关键词，也许会遇见新的惊喜。</p></div>}
  </div>;
}
