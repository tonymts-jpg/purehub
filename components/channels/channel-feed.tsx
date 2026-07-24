"use client";

import Link from "next/link";
import { LockKeyhole, Pin, Plus } from "lucide-react";
import { useState } from "react";
import type { ChannelDetailDto, ChannelPostDto } from "@/lib/channels/types";

export function ChannelFeed({
  slug,
  initialPosts,
  initialCursor
}: {
  slug: string;
  initialPosts: ChannelPostDto[];
  initialCursor: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/channels/${slug}?cursor=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error("无法加载更多频道作品。");
      const body = await response.json() as { channel: ChannelDetailDto };
      setPosts((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...body.channel.posts.filter((item) => !known.has(item.id))];
      });
      setCursor(body.channel.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载更多频道作品。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section data-testid="channel-feed" aria-labelledby="channel-feed-title" className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="channel-feed-title" className="text-2xl font-black">精选作品</h2>
          <p className="mt-1 text-sm muted">频道成员身份不会改变作品原有的付费或订阅权限。</p>
        </div>
      </div>
      {posts.length === 0 ? (
        <div className="glass rounded-lg px-5 py-16 text-center">
          <h3 className="font-black">频道暂时没有作品</h3>
          <p className="mt-2 text-sm muted">管理者加入作品后会显示在这里。</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((item) => (
            <article key={item.id} className="glass min-w-0 overflow-hidden rounded-lg">
              <div className={`relative aspect-[16/10] overflow-hidden ${item.post.cover || "cover-1"}`}>
                <div className="mesh absolute inset-0" />
                {item.pinnedAt && (
                  <span title="置顶作品" aria-label="置顶作品" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg bg-black/45 text-white backdrop-blur">
                    <Pin size={16} />
                  </span>
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-black uppercase tracking-[.12em] text-violet">{item.post.category}</p>
                <h3 className="mt-2 line-clamp-2 text-lg font-black">{item.post.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm leading-6 muted">{item.post.excerpt}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  {item.post.visibility === "free" ? (
                    <span className="text-xs font-bold muted">公开作品</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-coral">
                      <LockKeyhole size={14} />
                      {item.post.visibility === "members" ? "订阅专属" : "付费解锁"}
                    </span>
                  )}
                  <Link href={`/post/${item.post.id}`} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-black">
                    查看作品
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          aria-label="加载更多频道作品"
          className="mx-auto mt-6 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-5 text-sm font-black disabled:opacity-60"
        >
          <Plus size={17} />
          {loading ? "加载中…" : "加载更多"}
        </button>
      )}
    </section>
  );
}
