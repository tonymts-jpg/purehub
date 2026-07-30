"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { AccountListState } from "@/components/account/account-list-state";
import { AccountPostGrid } from "@/components/account/account-post-grid";
import type { AccountUnlockedListItem } from "@/lib/account/types";

function currentCallback(pathname: string) {
  return pathname.startsWith("/") ? `${pathname}${window.location.search}` : "/unlocked";
}

export default function UnlockedPage() {
  const pathname = usePathname();
  const [items, setItems] = useState<AccountUnlockedListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      setItems([]);
      setNextCursor(null);
      try {
        const response = await fetch("/api/me/unlocked");
        if (response.status === 401) {
          window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(currentCallback(pathname))}`);
          return;
        }
        const body = await response.json().catch(() => null) as { items?: AccountUnlockedListItem[]; nextCursor?: string | null; error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "暂时无法加载已解锁内容。");
        if (!active) return;
        setItems(body?.items ?? []);
        setNextCursor(body?.nextCursor ?? null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "暂时无法加载已解锁内容。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [pathname, refresh]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/unlocked?cursor=${encodeURIComponent(nextCursor)}`);
      const body = await response.json().catch(() => null) as { items?: AccountUnlockedListItem[]; nextCursor?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "暂时无法加载更多已解锁内容。");
      setItems((current) => [...current, ...(body?.items ?? [])]);
      setNextCursor(body?.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多已解锁内容。");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="已解锁内容" subtitle="这里仅展示一次购买和当前有效订阅提供访问权限的作品。" />
      <AccountListState loading={loading} error={error} empty={items.length === 0} onRetry={() => setRefresh((value) => value + 1)} emptyTitle="还没有已解锁内容" emptyDescription="一次购买或当前有效订阅的作品会显示在这里。">
        <AccountPostGrid posts={items.map((item) => item.post)} badge={(_, index) => <span className="rounded-full bg-ink/80 px-3 py-1.5 text-xs font-black text-white backdrop-blur">{items[index].source === "purchase" ? "Single Purchase" : "Active Subscription"}</span>} />
      </AccountListState>
      {nextCursor && !loading && <div className="mt-8 text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">{loadingMore ? "正在加载…" : "加载更多"}</button></div>}
    </div>
  );
}
