import { Bell, Heart, Sparkles, UserPlus, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { notifications } from "@/lib/data";

const icons:Record<string,React.ElementType>={member:UserPlus,like:Heart,payment:WalletCards,system:Sparkles};
export default function NotificationsPage(){
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8"><PageHeader title="通知" subtitle="与你的创作和支持有关的每一个新动态。"/>
    <div className="glass overflow-hidden rounded-[30px]">{notifications.map((n,i)=>{const Icon=icons[n.type]||Bell;return <div key={n.id} className={`flex gap-4 p-5 sm:p-6 ${i?"border-t border-[var(--line)]":""}`}><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${n.read?"bg-black/5 muted dark:bg-white/5":"brand-gradient text-white"}`}><Icon size={19}/></span><div className="flex-1"><div className="flex items-start justify-between gap-3"><h2 className="font-black">{n.title}</h2><span className="whitespace-nowrap text-xs muted">{n.time}</span></div><p className="mt-1 text-sm muted">{n.body}</p></div>{!n.read&&<span className="mt-2 h-2 w-2 rounded-full bg-coral"/>}</div>})}</div>
  </div>;
}
