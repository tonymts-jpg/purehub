"use client";

import { PageHeader } from "@/components/app-shell";
import { ActivityList } from "@/components/account/activity-list";
import { PostCard } from "@/components/post-card";
import type { AccountPostListItem } from "@/lib/account/types";

export default function LikesPage() {
  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title="喜欢" subtitle="这里保存着你点赞过的作品。" />
    <ActivityList<AccountPostListItem>
      endpoint="/api/me/likes"
      emptyTitle="还没有喜欢的作品"
      emptyDescription="去发现更多感兴趣的内容吧。"
      getKey={(item) => item.post.id}
      childrenClassName="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      renderItem={(item, actions) => <PostCard post={item.post} creator={item.creator} onUnlike={actions.remove} onMutationError={actions.reportError} />}
    />
  </div>;
}
