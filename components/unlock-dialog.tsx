"use client";

import Link from "next/link";
import { CreditCard, LockKeyhole, X } from "lucide-react";
import { useRef } from "react";
import { OverlayPortal } from "./overlay-portal";

type UnlockDialogProps = {
  open: boolean;
  title: string;
  visibility: "members" | "purchase";
  price?: number;
  creatorName: string;
  authenticated: boolean;
  callbackUrl: string;
  onClose(): void;
  onConfirmPurchase(): void;
  membershipHref: string;
};

export function UnlockDialog({
  open,
  title,
  visibility,
  price,
  creatorName,
  authenticated,
  callbackUrl,
  onClose,
  onConfirmPurchase,
  membershipHref
}: UnlockDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const isMembership = visibility === "members";
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <OverlayPortal open={open} onClose={onClose} initialFocusRef={closeButtonRef}>
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="解锁作品"
      ref={dialogRef}
      onKeyDown={trapFocus}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="glass w-full max-w-md rounded-[30px] p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <span className="brand-gradient grid h-12 w-12 place-items-center rounded-2xl text-white">
            {isMembership ? <LockKeyhole /> : <CreditCard />}
          </span>
          <button ref={closeButtonRef} onClick={onClose} aria-label="关闭解锁窗口" className="rounded-full border border-[var(--line)] p-2 muted"><X size={18}/></button>
        </div>
        <h2 className="mt-5 text-2xl font-black">{isMembership ? "查看会员专属作品" : "解锁完整作品"}</h2>
        <p className="mt-2 text-sm leading-6 muted">
          {isMembership ? `加入 ${creatorName} 的会员，查看完整作品与幕后内容。` : "一次购买，永久收藏完整作品。"}
        </p>
        <div className="my-6 rounded-2xl bg-black/[.04] p-4 dark:bg-white/[.05]">
          <p className="line-clamp-1 text-sm font-bold">{title}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs muted"><LockKeyhole size={14}/>{isMembership ? "会员内容" : "永久解锁 12 张图片"}</span>
            {!isMembership && <b className="text-xl">¥{price}</b>}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-full border border-[var(--line)] py-3 font-bold">返回</button>
          {!authenticated ? (
            <Link href={signInHref} className="brand-gradient flex-1 rounded-full py-3 text-center font-bold text-white">
              {isMembership ? "登录后查看会员方案" : "登录后解锁"}
            </Link>
          ) : isMembership ? (
            <Link href={membershipHref} className="brand-gradient flex-1 rounded-full py-3 text-center font-bold text-white">查看会员方案</Link>
          ) : (
            <button onClick={onConfirmPurchase} className="brand-gradient flex-1 rounded-full py-3 font-bold text-white">确认支付 ¥{price}</button>
          )}
        </div>
      </div>
    </div>
  </OverlayPortal>;
}
