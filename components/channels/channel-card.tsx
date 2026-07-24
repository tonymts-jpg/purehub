import Link from "next/link";
import { BadgeCheck, LockKeyhole, UsersRound } from "lucide-react";
import type { ChannelListItemDto, ChannelSafeSummaryDto } from "@/lib/channels/types";

function isSafeSummary(channel: ChannelListItemDto): channel is ChannelSafeSummaryDto {
  return !("access" in channel);
}

export function ChannelCard({ channel }: { channel: ChannelListItemDto }) {
  const privateSummary = isSafeSummary(channel);
  const initial = channel.name.trim().slice(0, 1).toUpperCase() || "P";

  return (
    <article
      data-testid="channel-card"
      data-channel-slug={channel.slug}
      className="glass flex min-w-0 flex-col overflow-hidden rounded-lg shadow-soft"
    >
      <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-violet/80 via-[#b55dba] to-coral">
        <div className="mesh absolute inset-0" />
        <span className="absolute bottom-3 left-4 grid h-12 w-12 place-items-center rounded-lg border border-white/30 bg-black/25 text-xl font-black text-white backdrop-blur">
          {initial}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1 truncate text-lg font-black">
              {channel.name}
              {channel.kind === "official" && (
                <BadgeCheck aria-label="官方频道" size={17} className="shrink-0 text-violet" />
              )}
            </h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-[.12em] muted">
              {channel.kind === "official" ? "官方频道" : "创作者频道"}
            </p>
          </div>
          {channel.visibility === "private" && (
            <span
              title="私人频道"
              aria-label="私人频道"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet/10 text-violet"
            >
              <LockKeyhole size={17} />
            </span>
          )}
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-6 muted">{channel.description}</p>
        {!privateSummary && (
          <p className="mt-3 flex min-w-0 items-center gap-2 truncate text-xs muted">
            <UsersRound size={15} className="shrink-0" />
            由 {channel.owner.name} 管理
          </p>
        )}
        <div className="mt-auto pt-5">
          <Link
            href={`/channels/${channel.slug}`}
            className={`flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-black ${
              privateSummary
                ? "brand-gradient text-white"
                : "border border-[var(--line)] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {privateSummary ? "申请加入" : "查看频道"}
          </Link>
        </div>
      </div>
    </article>
  );
}
