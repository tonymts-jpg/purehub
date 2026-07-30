import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, Bookmark, LockKeyhole } from "lucide-react";
import type { ChannelListItemDto } from "@/lib/channels/types";

function hasOwner(channel: ChannelListItemDto): channel is Extract<ChannelListItemDto, { owner: unknown }> {
  return "owner" in channel;
}

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
  const owner = hasOwner(channel) ? channel.owner : null;
  const coverAssetId = "coverAssetId" in channel ? channel.coverAssetId : null;
  const avatarAssetId = "avatarAssetId" in channel ? channel.avatarAssetId : null;
  const fallbackInitial = channel.name.trim().slice(0, 1).toUpperCase() || "P";
  return (
    <article data-testid="channel-favorite-card" className="glass overflow-hidden rounded-lg shadow-soft">
      <div className="relative flex aspect-[16/6] items-end bg-gradient-to-br from-violet via-[#b55dba] to-coral p-4">
        {coverAssetId && <Image data-testid="channel-favorite-cover" src={`/api/media/${coverAssetId}/content`} alt={`${channel.name} 频道封面`} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />}
        <div className="mesh absolute inset-0" />
        {coverAssetId ? null : avatarAssetId ? <Image data-testid="channel-favorite-avatar" src={`/api/media/${avatarAssetId}/content`} alt={`${channel.name} 频道头像`} width={48} height={48} className="relative h-12 w-12 rounded-lg border border-white/30 object-cover shadow-lg" /> : owner ? <span data-testid="channel-favorite-owner-avatar" className="relative grid h-12 w-12 place-items-center rounded-lg border border-white/30 bg-black/25 text-lg font-black text-white backdrop-blur">{owner.avatar}</span> : <span data-testid="channel-favorite-fallback" className="relative grid h-12 w-12 place-items-center rounded-lg border border-white/30 bg-black/25 text-lg font-black text-white backdrop-blur">{fallbackInitial}</span>}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1 truncate text-xl font-black">
              {channel.name}
              {channel.kind === "official" && <BadgeCheck aria-label="官方频道" size={18} className="shrink-0 text-violet" />}
            </h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-[.12em] muted">{channel.kind === "official" ? "官方频道" : "创作者频道"} · {channel.visibility === "public" ? "公开频道" : "私密频道"}</p>
          </div>
          {channel.visibility === "private" && <LockKeyhole aria-label="私密频道" size={18} className="shrink-0 text-violet" />}
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-6 muted">{channel.description}</p>
        {owner && <p className="mt-3 text-xs muted">由 {owner.name} 管理</p>}
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
