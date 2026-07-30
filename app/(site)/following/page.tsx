"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { ActivityList } from "@/components/account/activity-list";
import { FollowingCard } from "@/components/account/following-card";
import { redirectToAccountSignIn } from "@/lib/account/client";
import type { AccountFollowingListItem } from "@/lib/account/types";

export default function FollowingPage() {
  const pathname = usePathname();
  const [removingHandle, setRemovingHandle] = useState<string | null>(null);
  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title="关注" subtitle="查看并管理你正在关注的创作者。" />
    <ActivityList<AccountFollowingListItem>
      endpoint="/api/me/following"
      emptyTitle="还没有关注创作者"
      emptyDescription="关注喜欢的创作者，不错过新作品。"
      getKey={(item) => item.creator.id}
      childrenClassName="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      renderItem={(item, actions) => <FollowingCard item={item} removing={removingHandle === item.creator.handle} onUnfollow={async () => {
        setRemovingHandle(item.creator.handle);
        try {
          const response = await fetch(`/api/creators/${item.creator.handle}/follow`, { method: "DELETE" });
          if (response.status === 401) {
            redirectToAccountSignIn(pathname, window.location.search);
            return;
          }
          const body = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) throw new Error(body?.error || "暂时无法取消关注。");
          actions.remove();
        } catch (cause) {
          actions.reportError(cause instanceof Error ? cause.message : "暂时无法取消关注。");
        } finally {
          setRemovingHandle(null);
        }
      }} />}
    />
  </div>;
}
