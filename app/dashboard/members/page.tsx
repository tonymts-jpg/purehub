import { Crown, Search, Users } from "lucide-react";
import { PageHeader, Avatar } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";

const members=[["南风","造梦者","连续 8 个月","¥384"],["海盐柠檬","星图收藏家","连续 4 个月","¥392"],["Mika","旅人","连续 12 个月","¥216"],["橙子汽水","造梦者","连续 3 个月","¥144"],["北岛来信","旅人","本月加入","¥18"]];
export default function MembersPage(){
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><PageHeader title="会员管理" subtitle="认识那些持续支持你创作的人。"/><DashboardNav/>
    <div className="mb-6 grid gap-4 sm:grid-cols-3">{[["全部会员","2,438",Users],["本月新增","186",Crown],["续费率","92.4%",Crown]].map(([a,b,I])=><div key={a as string} className="glass rounded-3xl p-5"><I className="mb-5 text-violet"/><p className="text-sm muted">{a as string}</p><p className="mt-1 text-3xl font-black">{b as string}</p></div>)}</div>
    <div className="glass overflow-hidden rounded-[30px]"><div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4"><Search size={18} className="muted"/><input placeholder="搜索会员" className="w-full bg-transparent outline-none"/></div>{members.map(m=><div key={m[0]} className="flex flex-wrap items-center gap-4 border-b border-[var(--line)] p-5 last:border-0"><Avatar text={m[0][0]} small/><div className="min-w-40 flex-1"><p className="font-black">{m[0]}</p><p className="text-xs muted">{m[2]}</p></div><span className="rounded-full bg-violet/10 px-3 py-1 text-xs font-bold text-violet">{m[1]}</span><b>{m[3]}</b></div>)}</div>
  </div>;
}
