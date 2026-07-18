"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, ShieldCheck, Sparkles } from "lucide-react";
import { creators } from "@/lib/data";
import { useDemoStore } from "@/lib/store";
import { authClient } from "@/lib/auth-client";

export default function MembershipPage({params}:{params:Promise<{handle:string}>}) {
  const {handle}=use(params); const creator=creators.find(c=>c.handle===handle)||creators[0];
  const plans=creator.plans.length?creator.plans:creators[0].plans; const [selected,setSelected]=useState(plans[1]?.id||plans[0].id); const [paying,setPaying]=useState(false); const router=useRouter();
  const subscribe=useDemoStore(s=>s.subscribe); const plan=plans.find(p=>p.id===selected)!;
  const {data:session}=authClient.useSession(); const demoMode=process.env.NEXT_PUBLIC_DEMO_MODE==="true";
  const confirmSubscription=async()=>{
    if(!session?.user){window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`);return}
    try{
      const orderResponse=await fetch("/api/payments/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"subscription",itemId:plan.id})});
      if(!orderResponse.ok)throw new Error("order failed");
      const {order}=await orderResponse.json();
      const intentResponse=await fetch("/api/payments/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orderId:order.id,provider:"card"})});
      if(!intentResponse.ok)throw new Error("intent failed");
      const {intent}=await intentResponse.json();
      const confirmResponse=await fetch(`/api/payments/intents/${intent.id}/confirm`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:"membership_page"})});
      if(!confirmResponse.ok)throw new Error("confirm failed");
    }catch{
      if(!demoMode)return;
    }
    if(demoMode)subscribe(creator.id,plan.id);
    setPaying(false);
    router.push(`/creator/${creator.handle}`);
  };
  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
    <div className="text-center"><span className="brand-gradient inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white"><Sparkles size={14}/>直接支持你喜欢的博主</span><h1 className="mt-5 text-4xl font-black sm:text-5xl">加入 {creator.name} 的会员</h1><p className="mx-auto mt-3 max-w-2xl muted">持续获得独家作品、幕后过程和更近距离的交流。随时可以取消。</p></div>
    <div className="mt-10 grid gap-5 lg:grid-cols-3">{plans.map((p,i)=><button key={p.id} onClick={()=>setSelected(p.id)} className={`glass relative rounded-[30px] p-7 text-left transition hover:-translate-y-1 ${selected===p.id?"ring-2 ring-violet":""}`}>{i===1&&<span className="brand-gradient absolute right-5 top-5 rounded-full px-3 py-1 text-[11px] font-bold text-white">最受欢迎</span>}<span className="text-sm font-bold" style={{color:p.color}}>{p.name}</span><p className="mt-4"><b className="text-4xl">¥{p.price}</b><span className="muted"> / 月</span></p><div className="my-6 border-t border-[var(--line)]"/><ul className="space-y-3">{p.benefits.map(b=><li key={b} className="flex items-center gap-3 text-sm"><Check size={17} className="text-violet"/>{b}</li>)}</ul></button>)}</div>
    <div className="mx-auto mt-8 max-w-xl"><button onClick={()=>setPaying(true)} className="brand-gradient w-full rounded-full py-4 font-black text-white shadow-xl">选择「{plan.name}」· ¥{plan.price}/月</button><p className="mt-3 flex items-center justify-center gap-2 text-xs muted"><ShieldCheck size={14}/>这是 Demo 支付，不会收集或传输真实支付信息</p></div>
    {paying&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm"><div className="glass w-full max-w-md rounded-[30px] p-7"><div className="flex items-center gap-3"><span className="brand-gradient grid h-11 w-11 place-items-center rounded-2xl text-white"><CreditCard/></span><div><h2 className="text-xl font-black">模拟支付</h2><p className="text-xs muted">PureHub 安全结账演示</p></div></div><div className="my-6 rounded-2xl bg-black/[.04] p-4 dark:bg-white/[.05]"><div className="flex justify-between text-sm"><span>{creator.name} · {plan.name}</span><b>¥{plan.price}</b></div></div><label className="text-xs font-bold muted">演示卡号</label><input readOnly value="4242 4242 4242 4242" className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3"/><div className="mt-6 flex gap-3"><button onClick={()=>setPaying(false)} className="flex-1 rounded-full border border-[var(--line)] py-3 font-bold">返回</button><button onClick={confirmSubscription} className="brand-gradient flex-1 rounded-full py-3 font-bold text-white">确认支付</button></div></div></div>}
  </div>;
}
