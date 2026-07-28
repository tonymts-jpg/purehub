"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BadgeCheck, Flame, Search, SlidersHorizontal, TrendingUp, Users } from "lucide-react";
import { Avatar, PageHeader } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import { CONTENT_CATEGORIES, ContentCategory } from "@/lib/categories";
import { creators, posts } from "@/lib/data";
import { useDemoStore } from "@/lib/store";

type ViewType = "posts" | "creators";
type PostSort = "hot" | "latest" | "comments";
type CreatorSort = "hot" | "members" | "new";
type CategoryFilter = "全部" | ContentCategory;

export function TrendingPageContent({initialView="posts"}:{initialView?:ViewType}) {
  const [view,setView]=useState<ViewType>(initialView);
  const [category,setCategory]=useState<CategoryFilter>("全部");
  const [query,setQuery]=useState("");
  const [postSort,setPostSort]=useState<PostSort>("hot");
  const [creatorSort,setCreatorSort]=useState<CreatorSort>("hot");
  const customPosts=useDemoStore(s=>s.customPosts);
  const allPosts=useMemo(()=>[...customPosts,...posts],[customPosts]);

  const filteredPosts=useMemo(()=>{
    const keyword=query.trim().toLowerCase();
    return allPosts
      .filter(post=>category==="全部"||post.category===category)
      .filter(post=>!keyword||(post.title+post.excerpt+post.tags.join("")+post.category).toLowerCase().includes(keyword))
      .sort((a,b)=>{
        if(postSort==="latest") return orderDate(b.createdAt)-orderDate(a.createdAt);
        if(postSort==="comments") return b.comments.length-a.comments.length || b.likes-a.likes;
        return heatOfPost(b)-heatOfPost(a);
      });
  },[allPosts,category,postSort,query]);

  const filteredCreators=useMemo(()=>{
    const keyword=query.trim().toLowerCase();
    return creators
      .filter(creator=>category==="全部"||creator.category===category)
      .filter(creator=>!keyword||(creator.name+creator.handle+creator.bio+creator.category).toLowerCase().includes(keyword))
      .sort((a,b)=>{
        if(creatorSort==="members") return b.members-a.members;
        if(creatorSort==="new") return a.followers-b.followers;
        return b.followers-a.followers;
      });
  },[category,creatorSort,query]);

  const isPosts=view==="posts";
  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title={isPosts?"热度作品":"热度博主"} subtitle={isPosts?"按热度浏览全部作品，也可以按分类、关键词和互动数据重新排序。":"发现最受关注的博主，也可以按分类、会员数和关键词筛选。"} />

    <section className="glass mb-6 rounded-[30px] p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex rounded-full bg-black/[.04] p-1 dark:bg-white/[.06]">
          <button onClick={()=>setView("posts")} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black ${isPosts?"bg-ink text-white dark:bg-white dark:text-ink":"muted"}`}><Flame size={16}/>热度作品</button>
          <button onClick={()=>setView("creators")} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black ${!isPosts?"bg-ink text-white dark:bg-white dark:text-ink":"muted"}`}><Users size={16}/>热度博主</button>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-[var(--line)] px-4 py-3">
          <Search size={18} className="muted"/>
          <input value={query} onChange={event=>setQuery(event.target.value)} placeholder={isPosts?"搜索作品、标签或频道":"搜索博主、简介或频道"} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"/>
        </label>
        <label className="flex items-center gap-2 rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold">
          <SlidersHorizontal size={16} className="muted"/>
          <select value={isPosts?postSort:creatorSort} onChange={event=>isPosts?setPostSort(event.target.value as PostSort):setCreatorSort(event.target.value as CreatorSort)} className="bg-transparent outline-none">
            {isPosts?<>
              <option value="hot">热度优先</option>
              <option value="latest">最新发布</option>
              <option value="comments">评论最多</option>
            </>:<>
              <option value="hot">关注最多</option>
              <option value="members">会员最多</option>
              <option value="new">新锐博主</option>
            </>}
          </select>
        </label>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {(["全部",...CONTENT_CATEGORIES] as CategoryFilter[]).map(item=><button key={item} onClick={()=>setCategory(item)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${category===item?"bg-ink text-white dark:bg-white dark:text-ink":"bg-black/[.04] muted hover:text-[var(--text)] dark:bg-white/[.06]"}`}>{item}</button>)}
      </div>
    </section>

    {isPosts?<section>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">全部作品</h2><p className="text-sm muted">{filteredPosts.length} 个结果</p></div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{filteredPosts.map(post=><PostCard key={post.id} post={post}/>)}</div>
    </section>:<section>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">全部博主</h2><p className="text-sm muted">{filteredCreators.length} 个结果</p></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredCreators.map((creator,index)=><Link href={`/creator/${creator.handle}`} key={creator.id} className="glass group rounded-[30px] p-5 transition hover:-translate-y-1">
        <div className="flex items-start gap-4">
          <Avatar text={creator.avatar}/>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-coral">TOP {index+1}</p>
            <h3 className="mt-1 flex items-center gap-1 truncate text-lg font-black">{creator.name}{creator.verified&&<BadgeCheck size={17} className="text-violet"/>}</h3>
            <p className="text-sm muted">@{creator.handle} · {creator.category}</p>
          </div>
          <TrendingUp className="muted transition group-hover:text-coral"/>
        </div>
        <p className="mt-4 line-clamp-2 text-sm leading-6 muted">{creator.bio}</p>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat label="关注" value={`${(creator.followers/10000).toFixed(1)}万`}/>
          <Stat label="会员" value={creator.members.toLocaleString()}/>
          <Stat label="作品" value={allPosts.filter(post=>post.creatorId===creator.id).length.toString()}/>
        </div>
      </Link>)}</div>
    </section>}

    {((isPosts&&filteredPosts.length===0)||(!isPosts&&filteredCreators.length===0))&&<div className="glass rounded-3xl py-20 text-center"><Search className="mx-auto mb-4 muted"/><h3 className="font-black">没有找到相关结果</h3><p className="mt-2 text-sm muted">换个分类或关键词试试。</p></div>}
  </div>;
}

export default function TrendingPage() {
  return <TrendingPageContent initialView="posts"/>;
}

function heatOfPost(post:{likes:number;comments:{id:string}[];visibility:string}) {
  return post.likes + post.comments.length*60 + (post.visibility==="free"?20:0);
}

function orderDate(value:string) {
  if(value==="刚刚") return 4;
  if(value==="今天") return 3;
  if(value==="本周") return 2;
  return 1;
}

function Stat({label,value}:{label:string;value:string}) {
  return <div className="rounded-2xl bg-black/[.035] px-3 py-3 dark:bg-white/[.05]"><p className="text-sm font-black">{value}</p><p className="mt-1 text-[11px] muted">{label}</p></div>
}
