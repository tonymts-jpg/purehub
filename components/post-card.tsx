"use client";

import Link from "next/link";
import { Bookmark, Heart, LockKeyhole, MessageCircle, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { creators } from "@/lib/data";
import { Post } from "@/lib/types";
import { useDemoStore } from "@/lib/store";
import { Avatar } from "./app-shell";
import { MediaGallery } from "./media-gallery";
import { PaymentModal } from "./payment-modal";

export function PostCard({post}:{post:Post}) {
  const creator=creators.find(c=>c.id===post.creatorId)!;
  const router=useRouter();
  const [paying,setPaying]=useState(false);
  const {liked,bookmarked,toggleLike,toggleBookmark,subscriptions,unlocked,unlock}=useDemoStore();
  const isLiked=liked.includes(post.id), saved=bookmarked.includes(post.id);
  const hasAccess=post.visibility==="free"||subscriptions.some(item=>item.creatorId===creator.id)||unlocked.includes(post.id);
  const handleLocked=()=>{
    if(post.visibility==="members")router.push(`/membership/${creator.handle}`);
    else setPaying(true);
  };
  return <article className="glass overflow-hidden rounded-[28px] shadow-soft transition duration-300 hover:-translate-y-1">
    {post.media.length?<div className="relative bg-black/[.04] dark:bg-white/[.03]">
      <MediaGallery media={post.media} unlocked={hasAccess} compact onLockedClick={handleLocked}/>
      <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-start justify-between text-white">
        <span className="rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold backdrop-blur">{post.category}</span>
        {post.visibility!=="free"&&<span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink">{post.visibility==="members"?<LockKeyhole size={13}/>:<ShoppingBag size={13}/>} {post.visibility==="members"?"会员限定":`¥${post.price}`}</span>}
      </div>
      <Link href={`/post/${post.id}`} className="mx-2 mb-2 flex items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] py-2 text-xs font-bold transition hover:text-violet">查看全部 12 张</Link>
    </div>:<Link href={`/post/${post.id}`} className={`mesh relative block aspect-[16/10] overflow-hidden ${post.cover}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_28%,rgba(255,255,255,.36),transparent_18%),linear-gradient(120deg,transparent_35%,rgba(255,255,255,.12))]"/>
      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between text-white">
        <span className="rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold backdrop-blur">{post.category}</span>
        {post.visibility!=="free"&&<span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink">{post.visibility==="members"?<LockKeyhole size={13}/>:<ShoppingBag size={13}/>} {post.visibility==="members"?"会员限定":`¥${post.price}`}</span>}
      </div>
    </Link>}
    <div className="p-5">
      <div className="mb-4 flex items-center gap-3"><Avatar text={creator.avatar} small/><div><Link href={`/creator/${creator.handle}`} className="text-sm font-bold hover:text-violet">{creator.name}</Link><p className="text-xs muted">{post.createdAt} · {creator.category}</p></div></div>
      <Link href={`/post/${post.id}`}><h2 className="text-xl font-black leading-snug">{post.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 muted">{post.excerpt}</p></Link>
      <div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4">
        <div className="flex gap-4">
          <button onClick={()=>toggleLike(post.id)} aria-label="喜欢" className={`flex items-center gap-1.5 text-sm font-semibold ${isLiked?"text-coral":"muted hover:text-coral"}`}><Heart size={18} fill={isLiked?"currentColor":"none"}/>{post.likes+(isLiked?1:0)}</button>
          <span className="flex items-center gap-1.5 text-sm muted"><MessageCircle size={18}/>{post.comments.length}</span>
        </div>
        <button onClick={()=>toggleBookmark(post.id)} aria-label="收藏" className={saved?"text-violet":"muted hover:text-violet"}><Bookmark size={19} fill={saved?"currentColor":"none"}/></button>
      </div>
    </div>
    {paying&&<PaymentModal title={post.title} price={post.price||0} onClose={()=>setPaying(false)} onConfirm={()=>{unlock(post.id,post.price||0);setPaying(false)}}/>}
  </article>
}
