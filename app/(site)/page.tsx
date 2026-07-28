"use client";

import { useEffect, useState } from "react";
import { Hero } from "@/components/hero";
import { PostCard } from "@/components/post-card";
import { RightRail } from "@/components/right-rail";
import { getAllPosts, useDemoStore } from "@/lib/store";
import { CONTENT_CATEGORIES, ContentCategory } from "@/lib/categories";
import type { Post } from "@/lib/types";

const cats = ["为你推荐", ...CONTENT_CATEGORIES] as const;
type HomeCategory = "为你推荐" | ContentCategory;

export default function Home() {
  const [category, setCategory] = useState<HomeCategory>("为你推荐");
  const custom = useDemoStore((state) => state.customPosts);
  const all = getAllPosts(custom);
  const fallback = category === "为你推荐" ? all : all.filter((post) => post.category === category);
  const [apiPosts, setApiPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = category === "为你推荐" ? "" : `?category=${encodeURIComponent(category)}`;
    fetch(`/api/feed${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((body: { posts: Post[] }) => setApiPosts(body.posts))
      .catch(() => setApiPosts(null));
    return () => controller.abort();
  }, [category]);

  const filtered = apiPosts ?? fallback;

  return <div className="mx-auto flex max-w-[1460px] gap-8 px-4 py-6 sm:px-7 lg:py-8">
    <div className="min-w-0 flex-1">
      <Hero/>
      <div className="hide-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        {cats.map((cat) => <button key={cat} onClick={() => setCategory(cat)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${category === cat ? "bg-ink text-white dark:bg-white dark:text-ink" : "glass muted hover:text-[var(--text)]"}`}>{cat}</button>)}
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filtered.slice(0, 12).map((post) => <PostCard key={post.id} post={post}/>)}
      </div>
    </div>
    <RightRail/>
  </div>;
}
