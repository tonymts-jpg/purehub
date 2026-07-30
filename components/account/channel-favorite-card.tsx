import Link from "next/link";
import { BadgeCheck, Bookmark, LockKeyhole } from "lucide-react";
import type { ChannelListItemDto } from "@/lib/channels/types";

export function ChannelFavoriteCard({
  channel,
  occurredAt,
  onRemove,
  removing = false
}: {
  channel: ChannelListItemDto & { bookmarked: true };
  occurredAt: string;
  onRemove: () => void;
  removing?: boolean;
}) {
  return (
    <article data-testid="channel-favorite-card" className="glass overflow-hidden rounded-lg shadow-soft">
      <div className="relative aspect-[16/6] bg-gradient-to-br from-violet via-[#b55dba] to-coral"><div className="mesh absolute inset-0" /></div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1 truncate text-xl font-black">
              {channel.name}
              {channel.kind === "official" && <BadgeCheck aria-label="官方频道" size={18} className="shrink-0 text-violet" />}
            </h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-[.12em] muted">{channel.kind === "official" ? "官方频道" : "创作者频道"}</p>
          </div>
          {channel.visibility === "private" && <LockKeyhole aria-label="私密频道" size={18} className="shrink-0 text-violet" />}
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-6 muted">{channel.description}</p>
        <p className="mt-4 text-xs muted">收藏于 {new Date(occurredAt).toLocaleDateString("zh-CN")}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/channels/${channel.slug}`} className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--line)] px-4 text-sm font-black hover:bg-black/5 dark:hover:bg-white/5">查看频道</Link>
          <button type="button" onClick={onRemove} disabled={removing} aria-label="取消收藏频道" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-4 text-sm font-black text-violet disabled:cursor-wait disabled:opacity-70">
            <Bookmark size={17} fill="currentColor" />{removing ? "处理中…" : "取消收藏"}
          </button>
        </div>
      </div>
    </article>
  );
}
