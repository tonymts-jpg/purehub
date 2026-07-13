"use client";

import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, Bookmark, Heart, LockKeyhole, MessageCircle, ShoppingBag } from "lucide-react";
import { creators } from "@/lib/data";
import { getAllPosts, useDemoStore } from "@/lib/store";
import { Avatar } from "@/components/app-shell";
import { MediaGallery } from "@/components/media-gallery";
import { PaymentModal } from "@/components/payment-modal";

export default function PostPage({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params);
  const store=useDemoStore();
  const post=getAllPosts(store.customPosts).find(item=>item.id===id);
  const [comment,setComment]=useState("");
  const [paying,setPaying]=useState(false);

  if(!post)return <div className="p-20 text-center">作品不存在</div>;

  const creator=creators.find(item=>item.id===post.creatorId)!;
  const subscribed=store.subscriptions.some(item=>item.creatorId===creator.id);
  const unlocked=post.visibility==="free"||subscribed||store.unlocked.includes(post.id);
  const handleLocked=()=>{
    if(post.visibility==="members")window.location.href=`/membership/${creator.handle}`;
    else setPaying(true);
  };
  const confirmPurchase=async()=>{
    try{
      const orderResponse=await fetch("/api/payments/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"post_unlock",itemId:post.id,buyerUserId:"fan-demo"})});
      if(!orderResponse.ok)throw new Error("order failed");
      const {order}=await orderResponse.json();
      const intentResponse=await fetch("/api/payments/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orderId:order.id,provider:"card"})});
      if(!intentResponse.ok)throw new Error("intent failed");
      const {intent}=await intentResponse.json();
      const confirmResponse=await fetch(`/api/payments/intents/${intent.id}/confirm`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:"post_modal"})});
      if(!confirmResponse.ok)throw new Error("confirm failed");
    }catch{
      store.showToast("Server payment unavailable, using local demo unlock.");
    }
    store.unlock(post.id,post.price||0);
    setPaying(false);
  };

  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    {post.media.length?<div className="relative aspect-[16/9] overflow-hidden rounded-[36px] bg-black">
      <Image src={post.media[0].src} alt={post.media[0].alt} fill priority sizes="(max-width: 1024px) 100vw, 960px" className="object-cover"/>
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10"/>
      <div className="absolute bottom-5 left-5 rounded-full bg-black/45 px-4 py-2 text-xs font-bold text-white backdrop-blur">12 张原创虚拟人物作品</div>
    </div>:<div className={`mesh relative aspect-[16/9] overflow-hidden rounded-[36px] ${post.cover}`}><div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(255,255,255,.4),transparent_18%),linear-gradient(135deg,transparent,rgba(0,0,0,.28))]"/></div>}

    <div className="mx-auto -mt-12 max-w-3xl">
      <article className="glass relative rounded-[32px] p-6 shadow-soft sm:p-10">
        <div className="mb-7 flex items-center justify-between gap-4">
          <Link href={`/creator/${creator.handle}`} className="flex items-center gap-3">
            <Avatar text={creator.avatar}/>
            <div><p className="flex items-center gap-1 font-black">{creator.name}<BadgeCheck size={16} className="text-violet"/></p><p className="text-xs muted">{post.createdAt} · {post.category}</p></div>
          </Link>
          <button onClick={()=>store.toggleFollow(creator.id)} className="rounded-full bg-ink px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-ink">{store.followed.includes(creator.id)?"已关注":"关注"}</button>
        </div>

        <h1 className="text-3xl font-black leading-tight sm:text-5xl">{post.title}</h1>
        <p className="mt-4 text-lg leading-8 muted">{post.excerpt}</p>

        <div className="my-8 flex items-center gap-5 border-y border-[var(--line)] py-4">
          <button onClick={()=>store.toggleLike(post.id)} className={`flex items-center gap-2 font-bold ${store.liked.includes(post.id)?"text-coral":"muted"}`}><Heart size={20} fill={store.liked.includes(post.id)?"currentColor":"none"}/>{post.likes+(store.liked.includes(post.id)?1:0)}</button>
          <span className="flex items-center gap-2 muted"><MessageCircle size={20}/>{post.comments.length}</span>
          <button onClick={()=>store.toggleBookmark(post.id)} aria-label="收藏" className={`ml-auto ${store.bookmarked.includes(post.id)?"text-violet":"muted"}`}><Bookmark size={20} fill={store.bookmarked.includes(post.id)?"currentColor":"none"}/></button>
        </div>

        {post.media.length&&<section className="mb-8">
          <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-black">作品图集</h2><p className="mt-1 text-xs muted">{unlocked?"完整 12 张图片已解锁":"前 2 张免费预览，解锁后查看完整图集"}</p></div>{!unlocked&&<span className="flex items-center gap-1 rounded-full bg-coral/10 px-3 py-1.5 text-xs font-bold text-coral"><LockKeyhole size={13}/>尚未解锁</span>}</div>
          <MediaGallery media={post.media} unlocked={unlocked} onLockedClick={handleLocked}/>
        </section>}

        {unlocked?<div className="space-y-5 text-base leading-8"><p>{post.content}</p><p>这组作品包含人物主视觉、环境构图、造型细节和幕后记录。所有画面均为 PureHub Demo 使用的原创成年虚拟人物素材。</p></div>:
          <div className="relative overflow-hidden rounded-3xl border border-[var(--line)] p-8 text-center">
            <div className={`absolute inset-0 opacity-20 blur-xl ${post.cover}`}/>
            <div className="relative">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-ink text-white dark:bg-white dark:text-ink">{post.visibility==="members"?<LockKeyhole/>:<ShoppingBag/>}</span>
              <h2 className="text-2xl font-black">{post.visibility==="members"?"这是会员专属图集":"解锁完整 12 张图片"}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 muted">{post.visibility==="members"?`加入 ${creator.name} 的会员，查看完整作品与幕后过程。`:`一次购买，永久收藏。当前价格 ¥${post.price}。`}</p>
              {post.visibility==="members"?<Link href={`/membership/${creator.handle}`} className="brand-gradient mt-6 inline-flex rounded-full px-6 py-3 font-bold text-white">查看会员方案</Link>:<button onClick={()=>setPaying(true)} className="brand-gradient mt-6 rounded-full px-6 py-3 font-bold text-white">模拟支付 ¥{post.price}</button>}
            </div>
          </div>}

        <section className="mt-10">
          <h2 className="text-xl font-black">评论</h2>
          <div className="mt-4 flex gap-3">
            <input value={comment} onChange={event=>setComment(event.target.value)} placeholder="说说你的感受…" className="glass min-w-0 flex-1 rounded-full px-5 py-3 outline-none"/>
            <button onClick={()=>{if(comment.trim()){store.showToast("评论已发布");setComment("")}}} className="rounded-full bg-ink px-5 text-sm font-bold text-white dark:bg-white dark:text-ink">发布</button>
          </div>
          <div className="mt-5 space-y-4">{post.comments.map(item=><div key={item.id} className="flex gap-3"><Avatar text={item.user[0]} small/><div className="rounded-2xl bg-black/[.035] px-4 py-3 dark:bg-white/[.05]"><p className="text-sm font-bold">{item.user}<span className="ml-2 text-xs font-normal muted">{item.time}</span></p><p className="mt-1 text-sm muted">{item.text}</p></div></div>)}</div>
        </section>
      </article>
    </div>

    {paying&&<PaymentModal title={post.title} price={post.price||0} onClose={()=>setPaying(false)} onConfirm={confirmPurchase}/>}
  </div>;
}
