"use client";

import { CreditCard, LockKeyhole, X } from "lucide-react";

export function PaymentModal({
  title,
  price,
  onClose,
  onConfirm
}:{
  title:string;
  price:number;
  onClose:()=>void;
  onConfirm:()=>void;
}) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="payment-title" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <div className="glass w-full max-w-md rounded-[30px] p-7 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <span className="brand-gradient grid h-12 w-12 place-items-center rounded-2xl text-white"><CreditCard/></span>
        <button onClick={onClose} aria-label="关闭支付窗口" className="rounded-full border border-[var(--line)] p-2 muted"><X size={18}/></button>
      </div>
      <h2 id="payment-title" className="mt-5 text-2xl font-black">解锁完整图片</h2>
      <p className="mt-2 text-sm leading-6 muted">这是安全的 Demo 支付，不会收集或传输真实付款资料。</p>
      <div className="my-6 rounded-2xl bg-black/[.04] p-4 dark:bg-white/[.05]">
        <p className="line-clamp-1 text-sm font-bold">{title}</p>
        <div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs muted"><LockKeyhole size={14}/>永久解锁 12 张图片</span><b className="text-xl">¥{price}</b></div>
      </div>
      <label className="text-xs font-bold muted">演示卡号</label>
      <input readOnly value="4242 4242 4242 4242" className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3"/>
      <div className="mt-6 flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-full border border-[var(--line)] py-3 font-bold">返回</button>
        <button onClick={onConfirm} className="brand-gradient flex-1 rounded-full py-3 font-bold text-white">确认支付 ¥{price}</button>
      </div>
    </div>
  </div>;
}
