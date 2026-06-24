"use client";

import { useState } from "react";
import { Hero } from "@/components/hero";
import { PostCard } from "@/components/post-card";
import { RightRail } from "@/components/right-rail";
import { getAllPosts, useDemoStore } from "@/lib/store";
import { CONTENT_CATEGORIES, ContentCategory } from "@/lib/categories";

const cats = ["为你推荐", ...CONTENT_CATEGORIES] as const;
type HomeCategory = "为你推荐" | ContentCategory;
export default function Home() {
  const [category,setCategory]=useState<HomeCategory>("为你推荐"); const custom=useDemoStore(s=>s.customPosts);
  const all=getAllPosts(custom); const filtered=category==="为你推荐"?all:all.filter(p=>p.category===category);
  return <div className="mx-auto flex max-w-[1460px] gap-8 px-4 py-6 sm:px-7 lg:py-8">
    <div className="min-w-0 flex-1">
      <Hero/>
      <div className="hide-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        {cats.map(c=><button key={c} onClick={()=>setCategory(c)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${category===c?"bg-ink text-white dark:bg-white dark:text-ink":"glass muted hover:text-[var(--text)]"}`}>{c}</button>)}
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filtered.slice(0,12).map(p=><PostCard key={p.id} post={p}/>)}
      </div>
    </div>
    <RightRail/>
  </div>;
}
