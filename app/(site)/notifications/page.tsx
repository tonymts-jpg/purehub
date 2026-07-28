"use client";

import { Bell, Heart, MessageCircle, ShoppingBag, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";

type Item = {
  id: string; type: string; readAt: string | null; createdAt: string;
  actor: { name: string; handle: string } | null;
  post: { id: string; title: string } | null;
};

const iconMap: Record<string, React.ElementType> = { follow: UserPlus, like: Heart, comment: MessageCircle, purchase: ShoppingBag, subscription: ShoppingBag };
const labelMap: Record<string, string> = { follow: "关注了你", like: "喜欢了你的作品", comment: "评论了你的作品", purchase: "购买了你的作品", subscription: "加入了你的会员" };

export default function NotificationsPage() {
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{fetch("/api/notifications").then(response=>response.ok?response.json():Promise.reject()).then(body=>setItems(body.notifications)).finally(()=>setLoading(false))},[]);
  const markRead=async(id:string)=>{await fetch(`/api/notifications/${id}`,{method:"PATCH"});setItems(current=>current.map(item=>item.id===id?{...item,readAt:new Date().toISOString()}:item))};
  const readAll=async()=>{await fetch("/api/notifications/read-all",{method:"POST"});setItems(current=>current.map(item=>({...item,readAt:item.readAt??new Date().toISOString()})))};
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8"><PageHeader title="通知" subtitle="与你的创作和支持有关的最新动态。" action={<button onClick={readAll} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">全部标为已读</button>}/>
    <div className="glass overflow-hidden rounded-[28px]">{loading?<p className="p-8 text-center text-sm muted">载入中...</p>:items.length===0?<p className="p-12 text-center text-sm muted">目前没有通知</p>:items.map((item,index)=>{const Icon=iconMap[item.type]??Bell;return <button key={item.id} onClick={()=>markRead(item.id)} className={`flex w-full gap-4 p-5 text-left sm:p-6 ${index?"border-t border-[var(--line)]":""}`}><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.readAt?"bg-black/5 muted dark:bg-white/5":"brand-gradient text-white"}`}><Icon size={19}/></span><span className="min-w-0 flex-1"><span className="font-black">{item.actor?.name??"PureHub"}</span><span className="ml-1 text-sm muted">{labelMap[item.type]??"有一则新动态"}</span>{item.post&&<span className="mt-1 block truncate text-sm font-semibold">{item.post.title}</span>}<span className="mt-1 block text-xs muted">{new Date(item.createdAt).toLocaleString()}</span></span>{!item.readAt&&<span className="mt-2 h-2 w-2 rounded-full bg-coral"/>}</button>})}</div>
  </div>;
}
