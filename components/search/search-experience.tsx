"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { SearchResults, type SearchPage } from "@/components/search/search-results";

type ResultType = "post" | "creator" | "channel";

export function SearchExperience({
  query,
  type,
  initialPage,
  initialError
}: {
  query: string;
  type: ResultType | null;
  initialPage: SearchPage;
  initialError: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [isPending, startTransition] = useTransition();

  useEffect(() => setValue(query), [query]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    const normalized = value.trim();
    if (normalized) params.set("q", normalized);
    if (type) params.set("type", type);
    startTransition(() => router.push(`/search?${params}`));
  }

  return (
    <div className="mx-auto min-w-0 max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader title="统一搜索" subtitle="在公开作品、创作者和频道之间快速查找。" />
      <form onSubmit={submit} role="search" className="glass mb-5 flex min-w-0 items-center gap-3 rounded-lg p-2">
        <Search size={20} className="ml-2 shrink-0 muted" />
        <label className="min-w-0 flex-1">
          <span className="sr-only">搜索关键词</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            minLength={2}
            maxLength={100}
            placeholder="搜索作品、创作者或频道"
            className="min-h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="brand-gradient min-h-11 shrink-0 rounded-lg px-4 text-sm font-black text-white disabled:opacity-60 sm:px-6"
        >
          {isPending ? "搜索中…" : "搜索"}
        </button>
      </form>
      <SearchResults
        query={query}
        type={type}
        initialPage={initialPage}
        initialError={initialError}
      />
    </div>
  );
}
