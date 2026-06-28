"use client";

import { use } from "react";
import Link from "next/link";
import { BadgeCheck, BellRing } from "lucide-react";
import { creators, posts, products } from "@/lib/data";
import { Avatar } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import { useDemoStore } from "@/lib/store";

export default function CreatorPage({params}:{params:Promise<{handle:string}>}) {
  const {handle}=use(params); const creator=creators.find(c=>c.handle===handle); const store=useDemoStore();
  if(!creator)return <div className="p-20 text-center">博主不存在</div>;
  const creatorPosts=[...store.customPosts,...posts].filter(p=>p.creatorId===creator.id);
  return <div>
    <div className={`mesh relative h-60 ${creator.cover}`}><div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent"/></div>
    <div className="mx-auto max-w-6xl px-4 sm:px-8">
      <section className="glass relative -mt-20 rounded-[34px] p-6 shadow-soft sm:p-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end"><div className="rounded-full border-4 border-white dark:border-[#211d24]"><Avatar text={creator.avatar}/></div><div className="flex-1"><h1 className="flex items-center gap-2 text-3xl font-black">{creator.name}{creator.verified&&<BadgeCheck className="text-violet"/>}</h1><p className="mt-1 muted">@{creator.handle} · {creator.category}</p><p className="mt-3 max-w-2xl leading-7">{creator.bio}</p></div><div className="flex gap-2"><button onClick={()=>store.toggleFollow(creator.id)} className="rounded-full border border-[var(--line)] px-5 py-3 text-sm font-bold"><BellRing size={16} className="mr-2 inline"/>{store.followed.includes(creator.id)?"已关注":"关注"}</button><Link href={`/membership/${creator.handle}`} className="brand-gradient rounded-full px-5 py-3 text-sm font-bold text-white">加入会员</Link></div></div>
        <div className="mt-7 flex gap-8 border-t border-[var(--line)] pt-5"><p><b>{(creator.followers/10000).toFixed(1)}万</b><span className="ml-1 text-sm muted">关注者</span></p><p><b>{creator.members+store.subscriptions.filter(s=>s.creatorId===creator.id).length}</b><span className="ml-1 text-sm muted">会员</span></p><p><b>{creatorPosts.length}</b><span className="ml-1 text-sm muted">作品</span></p></div>
      </section>
      {products.some(p=>p.creatorId===creator.id)&&<section className="mt-10"><h2 className="mb-4 text-2xl font-black">数字商品</h2><div className="grid gap-4 sm:grid-cols-3">{products.filter(p=>p.creatorId===creator.id).map(p=><div key={p.id} className="glass rounded-3xl p-4"><div className={`aspect-video rounded-2xl ${p.cover}`}/><h3 className="mt-3 font-black">{p.title}</h3><p className="mt-2 text-lg font-black text-coral">¥{p.price}</p></div>)}</div></section>}
      <section className="py-10"><h2 className="mb-5 text-2xl font-black">最新作品</h2><div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{creatorPosts.map(p=><PostCard key={p.id} post={p}/>)}</div></section>
    </div>
  </div>;
}
