import Link from "next/link";
import { BarChart3, FileText, PlusCircle, Users, WalletCards } from "lucide-react";

export function DashboardNav(){
  const items=[["/dashboard","数据总览",BarChart3],["/dashboard/posts","作品管理",FileText],["/dashboard/posts/new","发布作品",PlusCircle],["/dashboard/members","会员管理",Users],["/dashboard/wallet","钱包与提现",WalletCards]] as const;
  return <div className="hide-scrollbar mb-8 flex gap-2 overflow-x-auto">{items.map(([href,label,Icon])=><Link key={href} href={href} className="glass flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold hover:text-violet"><Icon size={16}/>{label}</Link>)}</div>
}
