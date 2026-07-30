"use client";

import { useState } from "react";
import { Bookmark, LogOut, UserPlus } from "lucide-react";
import { authClient } from "@/lib/auth-client";

type MembershipState = "available" | "pending" | "member";

export function ChannelMembershipAction({
  slug,
  initialState,
  initialBookmarked = false,
  showMembership = true
}: {
  slug: string;
  initialState: MembershipState;
  initialBookmarked?: boolean;
  showMembership?: boolean;
}) {
  const { data: session } = authClient.useSession();
  const [state, setState] = useState(initialState);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busy, setBusy] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [error, setError] = useState("");

  function signInForCurrentLocation() {
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl.startsWith("/") ? callbackUrl : "/")}`);
  }

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

  async function toggleBookmark() {
    if (bookmarkBusy) return;
    if (!session?.user) return signInForCurrentLocation();
    const next = !bookmarked;
    setBookmarkBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/channels/${slug}/bookmark`, { method: next ? "POST" : "DELETE" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "暂时无法更新频道收藏。");
      setBookmarked(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法更新频道收藏。");
    } finally {
      setBookmarkBusy(false);
    }
  }

  return (
    <div className="w-full sm:w-auto">
      <div className="flex flex-wrap gap-3">
        {showMembership && <button
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
        </button>}
        <button type="button" onClick={() => void toggleBookmark()} disabled={bookmarkBusy} aria-label={bookmarked ? "取消收藏频道" : "收藏频道"} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-5 text-sm font-black text-violet disabled:cursor-wait disabled:opacity-70 sm:w-auto">
          <Bookmark size={17} fill={bookmarked ? "currentColor" : "none"} />
          {bookmarkBusy ? "处理中…" : bookmarked ? "已收藏" : "收藏"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 max-w-xs text-sm font-semibold text-red-500">{error}</p>}
    </div>
  );
}
