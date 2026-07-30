"use client";

import Link from "next/link";
import Image from "next/image";
import { PageHeader } from "@/components/app-shell";
import { ActivityList } from "@/components/account/activity-list";
import type { AccountPostListItem } from "@/lib/account/types";

function lastViewedLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function HistoryPage() {
  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <PageHeader title="浏览历史" subtitle="这里记录你最近查看过的作品。" />
    <ActivityList<AccountPostListItem>
      endpoint="/api/me/history"
      emptyTitle="还没有浏览历史"
      emptyDescription="查看作品详情后，记录会显示在这里。"
      getKey={(item) => item.post.id}
      childrenClassName="space-y-4"
      renderItem={(item) => {
        const media = item.post.media[0];
        return <article data-testid="history-item" className="glass overflow-hidden rounded-[24px] shadow-soft">
          <Link href={`/post/${item.post.id}`} className="flex gap-4 p-4 transition hover:bg-black/[.02] dark:hover:bg-white/[.03]">
            <div className={`relative flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl ${item.post.cover}`}>
              {media?.kind === "image" && <Image src={media.src} alt="" fill sizes="128px" className="object-cover" />}
              {media?.kind === "video" && <span className="text-xs font-black text-white">视频</span>}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <p className="text-sm font-bold text-violet">{item.creator?.name ?? "创作者"}</p>
              <h2 className="mt-1 line-clamp-2 text-lg font-black">{item.post.title}</h2>
              <p data-testid="history-last-viewed" className="mt-3 text-sm muted">最后浏览于 {lastViewedLabel(item.occurredAt)}</p>
            </div>
          </Link>
        </article>;
      }}
    />
  </div>;
}
