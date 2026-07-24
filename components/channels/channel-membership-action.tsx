"use client";

import { useState } from "react";
import { LogOut, UserPlus } from "lucide-react";

type MembershipState = "available" | "pending" | "member";

export function ChannelMembershipAction({
  slug,
  initialState
}: {
  slug: string;
  initialState: MembershipState;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function mutate() {
    if (busy || state === "pending") return;
    const previous = state;
    const leaving = state === "member";
    setBusy(true);
    setError("");
    setState(leaving ? "available" : "pending");
    try {
      const response = await fetch(
        leaving ? `/api/channels/${slug}/membership` : `/api/channels/${slug}/join-requests`,
        { method: leaving ? "DELETE" : "POST" }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "频道成员操作暂时失败。");
      }
      if (leaving) window.location.reload();
    } catch (cause) {
      setState(previous);
      setError(cause instanceof Error ? cause.message : "频道成员操作暂时失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={mutate}
        disabled={busy || state === "pending"}
        aria-label={state === "member" ? "退出频道" : "申请加入频道"}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-sm font-black disabled:cursor-wait disabled:opacity-70 sm:w-auto ${
          state === "member"
            ? "border border-[var(--line)]"
            : "brand-gradient text-white"
        }`}
      >
        {state === "member" ? <LogOut size={17} /> : <UserPlus size={17} />}
        {busy ? "处理中…" : state === "member" ? "退出频道" : state === "pending" ? "申请审核中" : "申请加入"}
      </button>
      {error && <p role="alert" className="mt-2 max-w-xs text-sm font-semibold text-red-500">{error}</p>}
    </div>
  );
}
