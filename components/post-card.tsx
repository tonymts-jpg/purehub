"use client";

import Link from "next/link";
import { Bookmark, Heart, LockKeyhole, MessageCircle, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { creators } from "@/lib/data";
import { Post } from "@/lib/types";
import { useDemoStore } from "@/lib/store";
import { Avatar } from "./app-shell";
import { MediaGallery } from "./media-gallery";
import { UnlockDialog } from "./unlock-dialog";
import { authClient } from "@/lib/auth-client";
import { usePostPurchase } from "./use-post-purchase";

type PostCardCreator = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
};

type PostCardProps = {
  post: Post;
  creator?: PostCardCreator;
  onUnlike?: (postId: string) => void;
  onUnbookmark?: (postId: string) => void;
  onMutationError?: (message: string) => void;
};

export function PostCard({post, creator: explicitCreator, onUnlike, onUnbookmark, onMutationError}:PostCardProps) {
  const creator=explicitCreator??creators.find(c=>c.id===post.creatorId);
  const [unlockOpen,setUnlockOpen]=useState(false);
  const {liked,bookmarked,subscriptions,unlocked}=useDemoStore();
  const {data:session}=authClient.useSession();
  const [isLiked,setIsLiked]=useState(post.liked??liked.includes(post.id));
  const [saved,setSaved]=useState(post.bookmarked??bookmarked.includes(post.id));
  const [likeCount,setLikeCount]=useState(post.likes);
  const [likePending,setLikePending]=useState(false);
  const [bookmarkPending,setBookmarkPending]=useState(false);
  const callbackUrl=typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  const purchase=usePostPurchase({
    postId:post.id,
    price:post.price||0,
    authenticated:Boolean(session?.user),
    callbackUrl,
    source:"homepage_modal",
    onPurchased:()=>setUnlockOpen(false)
  });
  const demoMode=process.env.NEXT_PUBLIC_DEMO_MODE==="true";
  const hasAccess=purchase.accessOverride??post.hasAccess??(
    post.visibility==="free"
    || (demoMode&&subscriptions.some(item=>item.creatorId===post.creatorId))
    || (demoMode&&unlocked.includes(post.id))
  );
  const signIn=()=>{window.location.href=`/sign-in?callbackUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`};
  const updateLike=async()=>{
    if(!session?.user)return signIn();
    if(likePending)return;
    const next=!isLiked; setIsLiked(next); setLikeCount(value=>value+(next?1:-1));
    setLikePending(true);
    try {
      const response=await fetch(`/api/posts/${post.id}/like`,{method:next?"POST":"DELETE"});
      if(response.status===401){setIsLiked(!next);setLikeCount(value=>value+(next?-1:1));return signIn()}
      if(!response.ok){
        const body=await response.json().catch(()=>null) as {error?:string}|null;
        throw new Error(body?.error||"暂时无法更新喜欢状态。");
      }
      if(!next)onUnlike?.(post.id);
    } catch(error) {
      setIsLiked(!next);setLikeCount(value=>value+(next?-1:1));
      onMutationError?.(error instanceof Error?error.message:"暂时无法更新喜欢状态。");
    } finally {
      setLikePending(false);
    }
  };
  const updateBookmark=async()=>{
    if(!session?.user)return signIn();
    if(bookmarkPending)return;
    const next=!saved; setSaved(next);
    setBookmarkPending(true);
    try {
      const response=await fetch(`/api/posts/${post.id}/bookmark`,{method:next?"POST":"DELETE"});
      if(response.status===401){setSaved(!next);return signIn()}
      if(!response.ok){
        const body=await response.json().catch(()=>null) as {error?:string}|null;
        throw new Error(body?.error||"暂时无法更新收藏状态。");
      }
      if(!next)onUnbookmark?.(post.id);
    } catch(error) {
      setSaved(!next);
      onMutationError?.(error instanceof Error?error.message:"暂时无法更新收藏状态。");
    } finally {
      setBookmarkPending(false);
    }
  };
  const handleLocked=()=>setUnlockOpen(true);
  return <article data-testid="post-card" data-post-id={post.id} className="glass overflow-hidden rounded-[28px] shadow-soft transition duration-300 hover:-translate-y-1">
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
      <div className="mb-4 flex items-center gap-3"><Avatar text={creator?.avatar??"?"} small/><div>{creator?.handle?<Link href={`/creator/${creator.handle}`} className="text-sm font-bold hover:text-violet">{creator.name}</Link>:<span className="text-sm font-bold">{creator?.name??"创作者"}</span>}<p className="text-xs muted">{post.createdAt} · {post.category}</p></div></div>
      <Link href={`/post/${post.id}`}><h2 className="text-xl font-black leading-snug">{post.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 muted">{post.excerpt}</p></Link>
      <div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4">
        <div className="flex gap-4">
          <button onClick={updateLike} disabled={likePending} aria-label="喜欢" className={`flex items-center gap-1.5 text-sm font-semibold disabled:cursor-wait disabled:opacity-70 ${isLiked?"text-coral":"muted hover:text-coral"}`}><Heart size={18} fill={isLiked?"currentColor":"none"}/>{likeCount}</button>
          <span className="flex items-center gap-1.5 text-sm muted"><MessageCircle size={18}/>{post.comments.length}</span>
        </div>
        <button onClick={updateBookmark} disabled={bookmarkPending} aria-label="收藏" className={`disabled:cursor-wait disabled:opacity-70 ${saved?"text-violet":"muted hover:text-violet"}`}><Bookmark size={19} fill={saved?"currentColor":"none"}/></button>
      </div>
    </div>
    <UnlockDialog open={unlockOpen} title={post.title} visibility={post.visibility === "members" ? "members" : "purchase"} price={post.price} creatorName={creator?.name??"创作者"} authenticated={Boolean(session?.user)} callbackUrl={callbackUrl} onClose={()=>setUnlockOpen(false)} onConfirmPurchase={async()=>{if(await purchase.confirmPurchase())setUnlockOpen(false)}} purchaseProcessing={purchase.processing} purchaseError={purchase.error} membershipHref={creator?.handle?`/membership/${creator.handle}`:"/"}/>
  </article>
}
