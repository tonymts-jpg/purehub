"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type InvitationState = "ready" | "working" | "accepted" | "rejected" | "error";

export default function ChannelInvitationPage() {
  const params = useParams<{ token: string }>();
  const { data: session, isPending } = authClient.useSession();
  const [state, setState] = useState<InvitationState>("ready");
  const [error, setError] = useState("");
  const token = params.token;

  async function decide(action: "accept" | "reject") {
    setState("working");
    setError("");
    const response = await fetch(`/api/channels/invitations/${encodeURIComponent(token)}`, {
      method: action === "accept" ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof body.error === "string" ? body.error : "邀请处理失败，请稍后重试。");
      setState("error");
      return;
    }
    setState(action === "accept" ? "accepted" : "rejected");
  }

  const callback = `/channels/invitations/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-8">
      <section className="glass rounded-[28px] p-6 shadow-soft sm:p-8">
        <h1 className="text-2xl font-black">频道邀请</h1>
        {isPending && <p role="status" className="mt-4 text-sm muted">正在确认登入状态…</p>}
        {!isPending && !session?.user && (
          <>
            <p className="mt-4 text-sm muted">请先登入邀请收件人的 PureHub 帐户，再接受或拒绝邀请。</p>
            <Link href={`/sign-in?callbackUrl=${encodeURIComponent(callback)}`} className="brand-gradient mt-5 inline-flex rounded-xl px-4 py-3 text-sm font-bold text-white">登入并继续</Link>
          </>
        )}
        {!isPending && session?.user && state === "ready" && (
          <>
            <p className="mt-4 text-sm muted">目前登入为 {session.user.email}。邀请会由服务器核对收件 Email。</p>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => void decide("accept")} className="brand-gradient rounded-xl px-4 py-3 text-sm font-bold text-white">接受邀请</button>
              <button type="button" onClick={() => void decide("reject")} className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-bold">拒绝邀请</button>
            </div>
          </>
        )}
        {state === "working" && <p role="status" className="mt-4 text-sm muted">正在处理邀请…</p>}
        {state === "accepted" && <p role="status" className="mt-4 text-sm font-bold text-emerald-600">邀请已接受，你现在可以访问该私人频道。</p>}
        {state === "rejected" && <p role="status" className="mt-4 text-sm font-bold">邀请已拒绝。</p>}
        {state === "error" && <p role="alert" className="mt-4 text-sm font-bold text-rose-600">{error}</p>}
      </section>
    </main>
  );
}
