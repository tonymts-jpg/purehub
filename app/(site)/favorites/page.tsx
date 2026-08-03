"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { AccountListState } from "@/components/account/account-list-state";
import { AccountPostGrid } from "@/components/account/account-post-grid";
import { ChannelFavoriteCard } from "@/components/account/channel-favorite-card";
import { redirectToAccountSignIn } from "@/lib/account/client";
import type { AccountChannelFavoriteListItem } from "@/lib/account/types";
import type { Post } from "@/lib/types";

type FavoriteType = "posts" | "channels";
type FavoriteChannel = AccountChannelFavoriteListItem;

function isFavoriteType(value: string | null): value is FavoriteType {
  return value === "channels" || value === "posts";
}

function FavoritesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedType = searchParams.get("type");
  const selectedType: FavoriteType = isFavoriteType(requestedType) ? requestedType : "posts";
  const [posts, setPosts] = useState<Post[]>([]);
  const [channels, setChannels] = useState<FavoriteChannel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [removingSlug, setRemovingSlug] = useState<string | null>(null);

  const items = selectedType === "posts" ? posts : channels;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      setPosts([]);
      setChannels([]);
      setNextCursor(null);
      try {
        const response = await fetch(`/api/me/favorites?type=${selectedType}`);
        if (response.status === 401) {
          redirectToAccountSignIn(pathname, window.location.search);
          return;
        }
        const body = await response.json().catch(() => null) as { items?: unknown[]; nextCursor?: string | null; error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "暂时无法加载收藏。");
        if (!active) return;
        if (selectedType === "posts") setPosts((body?.items ?? []) as Post[]);
        else setChannels((body?.items ?? []) as FavoriteChannel[]);
        setNextCursor(body?.nextCursor ?? null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "暂时无法加载收藏。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [pathname, refresh, selectedType]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/favorites?type=${selectedType}&cursor=${encodeURIComponent(nextCursor)}`);
      if (response.status === 401) {
        redirectToAccountSignIn(pathname, window.location.search);
        return;
      }
      const body = await response.json().catch(() => null) as { items?: unknown[]; nextCursor?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "暂时无法加载更多收藏。");
      if (selectedType === "posts") setPosts((current) => [...current, ...((body?.items ?? []) as Post[])]);
      else setChannels((current) => [...current, ...((body?.items ?? []) as FavoriteChannel[])]);
      setNextCursor(body?.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多收藏。");
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeChannel(item: FavoriteChannel) {
    const { channel } = item;
    setRemovingSlug(channel.slug);
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channel.slug}/bookmark`, { method: "DELETE" });
      if (response.status === 401) {
        redirectToAccountSignIn(pathname, window.location.search);
        return;
      }
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "暂时无法取消收藏频道。");
      setChannels((current) => current.filter((candidate) => candidate.channel.slug !== channel.slug));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法取消收藏频道。");
    } finally {
      setRemovingSlug(null);
    }
  }

  function selectType(type: FavoriteType) {
    router.replace(type === "posts" ? "/favorites" : "/favorites?type=channels");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="收藏" subtitle="保存喜欢的作品和频道，随时回来继续浏览。" />
      <div role="tablist" aria-label="收藏类型" className="mb-6 inline-flex rounded-lg border border-[var(--line)] p-1">
        <button type="button" role="tab" aria-selected={selectedType === "posts"} onClick={() => selectType("posts")} className={`rounded-md px-4 py-2 text-sm font-bold ${selectedType === "posts" ? "bg-violet text-white" : "muted"}`}>作品</button>
        <button type="button" role="tab" aria-selected={selectedType === "channels"} onClick={() => selectType("channels")} className={`rounded-md px-4 py-2 text-sm font-bold ${selectedType === "channels" ? "bg-violet text-white" : "muted"}`}>频道</button>
      </div>
      <AccountListState loading={loading} error={error} empty={items.length === 0} onRetry={() => setRefresh((value) => value + 1)} emptyTitle="还没有收藏内容" emptyDescription="去发现喜欢的作品和频道吧。">
        {selectedType === "posts" ? <AccountPostGrid posts={posts} /> : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((item) => <ChannelFavoriteCard key={item.channel.slug} channel={item.channel} occurredAt={item.occurredAt} onRemove={() => void removeChannel(item)} removing={removingSlug === item.channel.slug} />)}
          </div>
        )}
      </AccountListState>
      {nextCursor && !loading && (
        <div className="mt-8 text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">{loadingMore ? "正在加载…" : "加载更多"}</button></div>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense>
      <FavoritesContent />
    </Suspense>
  );
}
