"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Heart, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { creators } from "@/lib/data";
import type { TrendingPostDto } from "@/lib/search/repository";
import { useDemoStore } from "@/lib/store";
import { Avatar } from "./app-shell";

export function RightRail() {
  const {followed,toggleFollow}=useDemoStore();
  const [hotPosts,setHotPosts]=useState<TrendingPostDto[]>([]);

  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/trending/posts?limit=4",{signal:controller.signal})
      .then((response)=>response.ok?response.json():Promise.reject(response))
      .then((body:{posts:TrendingPostDto[]})=>setHotPosts(
        Array.isArray(body.posts)?body.posts.slice(0,4):[]
      ))
      .catch(()=>setHotPosts([]));
    return()=>controller.abort();
  },[]);

  return <aside className="hidden w-80 shrink-0 2xl:block">
    <div className="glass sticky top-7 rounded-[28px] p-5">
      <section data-testid="hot-posts">
        <div className="mb-5 flex items-center gap-2"><TrendingUp size={18} className="text-coral"/><h3 className="font-black">热度作品</h3></div>
        <div className="space-y-4">
          {hotPosts.map((post)=>{
            const preview=post.media[0];
            return <article key={post.id} data-testid="hot-post-item" className="flex items-center gap-3">
              <Link href={`/post/${post.id}`} className={`relative h-14 w-[72px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ${post.cover}`}>
                {preview?.kind==="image"
                  ?<Image src={preview.src} alt={preview.alt} width={72} height={56} unoptimized className="h-full w-full object-cover"/>
                  :preview?.kind==="video"
                    ?<video src={preview.src} aria-label={preview.alt} muted preload="metadata" className="h-full w-full object-cover"/>
                    :<span aria-label={`${post.title}缩略图`} className="block h-full w-full"/>}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/post/${post.id}`} className="block truncate text-sm font-bold">{post.title}</Link>
                <Link href={`/creator/${post.creator.handle}`} className="mt-1 block truncate text-xs muted">{post.creator.name}</Link>
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-coral"><Heart size={12} aria-hidden="true"/><span>{post.likes}</span></p>
              </div>
            </article>;
          })}
        </div>
        <Link href="/trending/posts" className="mt-6 flex items-center justify-center gap-2 border-t border-[var(--line)] pt-4 text-sm font-bold text-violet">查看全部熱度作品<ArrowRight size={15}/></Link>
      </section>
      <section data-testid="hot-creators" className="mt-6 border-t border-[var(--line)] pt-6">
        <div className="mb-5 flex items-center gap-2"><TrendingUp size={18} className="text-coral"/><h3 className="font-black">热度博主</h3></div>
        <div className="space-y-5">
          {[...creators].sort((a,b)=>b.followers-a.followers).slice(0,4).map(c=><div key={c.id} className="flex items-center gap-3">
            <Avatar text={c.avatar} small/><div className="min-w-0 flex-1"><Link href={`/creator/${c.handle}`} className="flex items-center gap-1 truncate text-sm font-bold">{c.name}{c.verified&&<BadgeCheck size={14} className="text-violet"/>}</Link><p className="text-xs muted">{c.category} · {(c.followers/10000).toFixed(1)}万关注</p></div>
            <button onClick={()=>toggleFollow(c.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${followed.includes(c.id)?"bg-black/5 muted dark:bg-white/10":"bg-ink text-white dark:bg-white dark:text-ink"}`}>{followed.includes(c.id)?"已关注":"关注"}</button>
          </div>)}
        </div>
        <Link href="/trending/creators" className="mt-6 flex items-center justify-center gap-2 border-t border-[var(--line)] pt-4 text-sm font-bold text-violet">查看全部热度博主<ArrowRight size={15}/></Link>
      </section>
    </div>
  </aside>
}
