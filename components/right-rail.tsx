"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, TrendingUp } from "lucide-react";
import { creators } from "@/lib/data";
import { useDemoStore } from "@/lib/store";
import { Avatar } from "./app-shell";

export function RightRail() {
  const {followed,toggleFollow}=useDemoStore();
  return <aside className="hidden w-80 shrink-0 2xl:block">
    <div className="glass sticky top-7 rounded-[28px] p-5">
      <div className="mb-5 flex items-center gap-2"><TrendingUp size={18} className="text-coral"/><h3 className="font-black">值得关注</h3></div>
      <div className="space-y-5">
        {creators.slice(0,4).map(c=><div key={c.id} className="flex items-center gap-3">
          <Avatar text={c.avatar} small/><div className="min-w-0 flex-1"><Link href={`/creator/${c.handle}`} className="flex items-center gap-1 truncate text-sm font-bold">{c.name}{c.verified&&<BadgeCheck size={14} className="text-violet"/>}</Link><p className="text-xs muted">{c.category} · {(c.followers/10000).toFixed(1)}万关注</p></div>
          <button onClick={()=>toggleFollow(c.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${followed.includes(c.id)?"bg-black/5 muted dark:bg-white/10":"bg-ink text-white dark:bg-white dark:text-ink"}`}>{followed.includes(c.id)?"已关注":"关注"}</button>
        </div>)}
      </div>
      <Link href="/explore" className="mt-6 flex items-center justify-center gap-2 border-t border-[var(--line)] pt-4 text-sm font-bold text-violet">发现更多创作者<ArrowRight size={15}/></Link>
    </div>
  </aside>
}
