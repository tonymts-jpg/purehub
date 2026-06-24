"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, RotateCcw, Sparkles, UserRound, WandSparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { useDemoStore } from "@/lib/store";

const steps=[["探索作品","从推荐动态发现创作者与多种内容形式。","/"],["订阅解锁","选择会员等级，体验安全的模拟支付。","/membership/yuki"],["创作者工作台","查看收入、会员增长与作品表现。","/dashboard"],["发布新作品","设置公开或会员权限，并即时加入动态。","/dashboard/posts/new"]];
export default function DemoPage(){
  const {role,setRole,reset}=useDemoStore();
  const [resetDone,setResetDone]=useState(false);
  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8"><PageHeader title="PureHub 产品演示" subtitle="为投资人和合作伙伴准备的一条完整体验路径。"/>
    <section className="overflow-hidden rounded-[34px] bg-ink p-7 text-white sm:p-10"><div className="flex flex-col justify-between gap-8 md:flex-row md:items-center"><div><span className="flex items-center gap-2 text-sm font-bold text-[#ff8b82]"><WandSparkles size={17}/>交互式产品 Demo</span><h2 className="mt-3 text-3xl font-black sm:text-4xl">现在以「{role==="fan"?"粉丝":"创作者"}」身份浏览</h2><p className="mt-3 max-w-xl text-sm leading-7 text-white/65">所有支付、收入、会员与作品数据均为本地模拟。状态会保存在当前浏览器，你也可以随时重置。</p>{resetDone&&<p className="mt-3 flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 size={16}/>Demo 数据已重置</p>}</div><div className="flex shrink-0 flex-wrap gap-3"><button onClick={()=>setRole(role==="fan"?"creator":"fan")} className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-ink"><UserRound size={17}/>切换为{role==="fan"?"创作者":"粉丝"}</button><button onClick={()=>{reset();setResetDone(true)}} className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-bold"><RotateCcw size={17}/>重置</button></div></div></section>
    <div className="mt-8 grid gap-5 sm:grid-cols-2">{steps.map((s,i)=><Link href={s[2]} key={s[0]} className="glass group rounded-[28px] p-6 transition hover:-translate-y-1"><div className="flex items-center justify-between"><span className="brand-gradient grid h-10 w-10 place-items-center rounded-2xl text-sm font-black text-white">0{i+1}</span><ArrowRight className="muted transition group-hover:translate-x-1 group-hover:text-violet"/></div><h3 className="mt-6 text-xl font-black">{s[0]}</h3><p className="mt-2 text-sm leading-6 muted">{s[1]}</p></Link>)}</div>
    <div className="glass mt-8 rounded-[28px] p-6"><h3 className="flex items-center gap-2 font-black"><Sparkles size={18} className="text-coral"/>演示能力</h3><div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">{["响应式桌面与手机体验","深浅色主题切换","会员订阅与内容解锁","点赞、收藏与关注状态","创作者发布与作品管理","收入图表与模拟提现","localStorage 状态持久化","一键重置演示数据"].map(x=><p key={x} className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500"/>{x}</p>)}</div></div>
  </div>;
}
