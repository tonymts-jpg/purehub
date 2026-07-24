"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ChannelCard } from "@/components/channels/channel-card";
import type { ChannelListItemDto } from "@/lib/channels/types";

type ChannelPage = { channels: ChannelListItemDto[]; nextCursor: string | null };
type KindFilter = "all" | "official" | "creator";

export default function ChannelsPage() {
  const [data, setData] = useState<ChannelPage>({ channels: [], nextCursor: null });
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/channels?limit=20", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("频道目录暂时无法使用。")))
      .then((body: ChannelPage) => setData(body))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "频道目录暂时无法使用。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.channels.filter((channel) => (
      (kind === "all" || channel.kind === kind)
      && (!keyword || `${channel.name} ${channel.description}`.toLowerCase().includes(keyword))
    ));
  }, [data.channels, kind, query]);

  async function loadMore() {
    if (!data.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetch(`/api/channels?limit=20&cursor=${encodeURIComponent(data.nextCursor)}`);
      if (!response.ok) throw new Error("无法加载更多频道。");
      const body = await response.json() as ChannelPage;
      setData((current) => {
        const known = new Set(current.channels.map((channel) => channel.slug));
        return {
          channels: [...current.channels, ...body.channels.filter((channel) => !known.has(channel.slug))],
          nextCursor: body.nextCursor
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载更多频道。");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="探索频道" subtitle="浏览官方策展、创作者主题与可申请加入的私人频道。" />
      <section className="glass mb-7 rounded-lg p-4">
        <label className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--line)] px-4 py-3">
          <Search size={18} className="shrink-0 muted" />
          <span className="sr-only">筛选频道</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按名称或简介筛选频道"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </label>
        <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1">
          {([
            ["all", "全部"],
            ["official", "官方"],
            ["creator", "创作者"]
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-black ${
                kind === value ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-[var(--line)] muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div role="status" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="glass aspect-[4/3] animate-pulse rounded-lg" />)}
          <span className="sr-only">正在加载频道</span>
        </div>
      ) : error && data.channels.length === 0 ? (
        <div role="alert" className="glass rounded-lg px-5 py-16 text-center">
          <h2 className="font-black">无法显示频道</h2>
          <p className="mt-2 text-sm text-red-500">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-lg px-5 py-16 text-center">
          <h2 className="font-black">没有符合条件的频道</h2>
          <p className="mt-2 text-sm muted">尝试其他关键词或频道类型。</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((channel) => <ChannelCard key={channel.slug} channel={channel} />)}
        </div>
      )}
      {error && data.channels.length > 0 && <p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
      {data.nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          aria-label="加载更多频道"
          className="mx-auto mt-7 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-5 text-sm font-black disabled:opacity-60"
        >
          <Plus size={17} />
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      )}
    </div>
  );
}
