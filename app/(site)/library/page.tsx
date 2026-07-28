"use client";

import { useEffect, useState } from "react";
import { Bookmark, LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import { getAllPosts, useDemoStore } from "@/lib/store";
import type { Post } from "@/lib/types";

export default function LibraryPage() {
  const s=useDemoStore();
  const demoMode=process.env.NEXT_PUBLIC_DEMO_MODE==="true";
  const [serverPosts,setServerPosts]=useState<Post[]>([]);
  useEffect(()=>{fetch("/api/feed").then(response=>response.ok?response.json():null).then(body=>body?.posts&&setServerPosts(body.posts)).catch(()=>undefined)},[]);
  const all=serverPosts.length?serverPosts:(demoMode?getAllPosts(s.customPosts):[]);
  const saved=all.filter(p=>p.bookmarked||(demoMode&&s.bookmarked.includes(p.id)));
  const unlocked=all.filter(p=>p.hasAccess||(demoMode&&(s.unlocked.includes(p.id)||s.subscriptions.some(x=>x.creatorId===p.creatorId&&p.visibility==="members"))));
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><PageHeader title="我的收藏库" subtitle="所有支持过的创作，都在这里继续发光。"/>
    <section className="mb-10"><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><LockKeyhole size={20} className="text-violet"/>已解锁内容</h2>{unlocked.length?<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{unlocked.map(p=><PostCard key={p.id} post={p}/>)}</div>:<Empty title="还没有解锁内容" text="订阅博主或购买数字作品后，它们会出现在这里。"/>}</section>
    <section><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Bookmark size={20} className="text-coral"/>收藏作品</h2>{saved.length?<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{saved.map(p=><PostCard key={p.id} post={p}/>)}</div>:<Empty title="收藏夹还是空的" text="在探索作品时点击书签，稍后就能轻松回来。"/>}</section>
  </div>;
}
function Empty({title,text}:{title:string;text:string}){return <div className="glass rounded-3xl py-16 text-center"><h3 className="font-black">{title}</h3><p className="mt-2 text-sm muted">{text}</p></div>}
