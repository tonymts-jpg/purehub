"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Avatar } from "@/components/app-shell";
import type { AccountFollowingListItem } from "@/lib/account/types";

type FollowingCardProps = {
  item: AccountFollowingListItem;
  onUnfollow: () => Promise<void>;
  removing: boolean;
};

function localizedDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

export function FollowingCard({ item, onUnfollow, removing }: FollowingCardProps) {
  const { creator } = item;
  return (
    <article data-testid="following-card" className="glass rounded-[28px] p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <Avatar text={creator.avatar} />
        <div className="min-w-0 flex-1">
          <Link href={`/creator/${creator.handle}`} className="inline-flex items-center gap-1 text-lg font-black hover:text-violet">
            {creator.name}{creator.verified && <BadgeCheck size={17} className="text-violet" />}
          </Link>
          {creator.category && <p className="mt-1 text-sm muted">{creator.category}</p>}
          {creator.bio && <p className="mt-3 line-clamp-3 text-sm leading-6 muted">{creator.bio}</p>}
          <p className="mt-3 text-xs muted">关注于 {localizedDate(item.occurredAt)}</p>
        </div>
      </div>
      <button type="button" onClick={() => void onUnfollow()} disabled={removing} className="mt-5 w-full rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-black hover:border-coral hover:text-coral disabled:cursor-wait disabled:opacity-70">
        {removing ? "正在取消关注…" : "取消关注"}
      </button>
    </article>
  );
}
