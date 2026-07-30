import type { ReactNode } from "react";
import type { Post } from "@/lib/types";
import { PostCard } from "@/components/post-card";

export function AccountPostGrid({
  posts,
  badge
}: {
  posts: Post[];
  badge?: (post: Post, index: number) => ReactNode;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {posts.map((post, index) => (
        <div key={post.id} className="relative min-w-0">
          {badge && <div className="absolute left-4 top-4 z-10">{badge(post, index)}</div>}
          <PostCard post={post} />
        </div>
      ))}
    </div>
  );
}
