import type { ReactNode } from "react";
import type { AccountPostCreator } from "@/lib/account/types";
import type { Post } from "@/lib/types";
import { PostCard } from "@/components/post-card";

export function AccountPostGrid({
  items,
  badge
}: {
  items: Array<{ post: Post; creator: AccountPostCreator }>;
  badge?: (item: { post: Post; creator: AccountPostCreator }, index: number) => ReactNode;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => (
        <div key={item.post.id} className="relative min-w-0">
          {badge && <div className="absolute left-4 top-4 z-10">{badge(item, index)}</div>}
          <PostCard post={item.post} creator={item.creator} />
        </div>
      ))}
    </div>
  );
}
