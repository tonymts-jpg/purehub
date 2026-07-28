"use client";

import { ArrowDownRight, ArrowUpRight, Eye, Heart, Users, WalletCards } from "lucide-react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";
import { useDemoStore } from "@/lib/store";

const IncomeChart=dynamic(()=>import("@/components/income-chart"),{ssr:false,loading:()=> <div className="h-full animate-pulse rounded-2xl bg-black/5 dark:bg-white/5"/>});

export default function Dashboard(){
  const {balance,transactions}=useDemoStore();
  const stats=[["本月收入",`¥${balance.toLocaleString()}`,"18.4%",WalletCards],["活跃会员","2,438","8.2%",Users],["作品浏览","18.6万","24.7%",Eye],["互动率","12.8%","1.6%",Heart]] as const;
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><PageHeader title="早上好，Yuki" subtitle="你的创作正在被更多人看见，也正在产生持续价值。"/><DashboardNav/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([name,value,change,Icon])=><div key={name} className="glass rounded-3xl p-5"><div className="flex items-center justify-between"><span className="muted"><Icon size={19}/></span><span className="flex items-center text-xs font-bold text-emerald-500"><ArrowUpRight size={14}/>{change}</span></div><p className="mt-5 text-sm muted">{name}</p><p className="mt-1 text-3xl font-black">{value}</p></div>)}</div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]"><section className="glass min-w-0 rounded-[30px] p-6"><h2 className="font-black">90 天收入趋势</h2><p className="mt-1 text-sm muted">会员和数字商品收入</p><div className="mt-6 h-72 min-w-0"><IncomeChart/></div></section>
      <section className="glass rounded-[30px] p-6"><h2 className="font-black">近期交易</h2><div className="mt-5 space-y-5">{transactions.slice(0,5).map(t=><div key={t.id} className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-2xl ${t.amount>0?"bg-emerald-500/10 text-emerald-500":"bg-coral/10 text-coral"}`}>{t.amount>0?<ArrowUpRight size={18}/>:<ArrowDownRight size={18}/>}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{t.title}</p><p className="text-xs muted">{t.date}</p></div><b className={t.amount>0?"text-emerald-500":""}>{t.amount>0?"+":""}¥{Math.abs(t.amount)}</b></div>)}</div></section>
    </div>
  </div>;
}
