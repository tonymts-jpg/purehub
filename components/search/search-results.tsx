"use client";

import Link from "next/link";
import { FileText, Plus, Radio, Search, UserRound } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/lib/channels/types";

type ResultType = "post" | "creator" | "channel";
export type SearchPage = { results: SearchResult[]; nextCursor: string | null };

const tabs: Array<{ value: ResultType | null; label: string; id: string }> = [
  { value: null, label: "全部", id: "all" },
  { value: "post", label: "作品", id: "post" },
  { value: "creator", label: "创作者", id: "creator" },
  { value: "channel", label: "频道", id: "channel" }
];

const icons = {
  post: FileText,
  creator: UserRound,
  channel: Radio
};

export function SearchResults({
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
  const [data, setData] = useState(initialPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(initialError);
  const [isPending, startTransition] = useTransition();
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const selectedIndex = tabs.findIndex((tab) => tab.value === type);
  const selectedTab = tabs[selectedIndex];

  useEffect(() => {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setData(initialPage);
    setError(initialError);
    setLoadingMore(false);
  }, [initialError, initialPage, query, type]);

  function targetUrl(nextType: ResultType | null) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextType) params.set("type", nextType);
    return `/search?${params}`;
  }

  function selectType(nextType: ResultType | null, focus = false) {
    const target = tabs.find((tab) => tab.value === nextType)!;
    if (focus) document.getElementById(`search-tab-${target.id}`)?.focus();
    startTransition(() => router.push(targetUrl(nextType)));
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectType(tabs[nextIndex].value, true);
  }

  async function loadMore() {
    if (!data.nextCursor || loadingMore) return;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setLoadingMore(true);
    setError("");
    const params = new URLSearchParams({ q: query, limit: "6", cursor: data.nextCursor });
    if (type) params.set("type", type);
    try {
      const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error("无法加载更多搜索结果。");
      const body = await response.json() as SearchPage;
      if (requestGeneration.current !== generation) return;
      setData((current) => {
        const known = new Set(current.results.map((item) => `${item.entityType}:${item.entityId}`));
        return {
          results: [...current.results, ...body.results.filter((item) => !known.has(`${item.entityType}:${item.entityId}`))],
          nextCursor: body.nextCursor
        };
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (requestGeneration.current === generation) {
        setError(cause instanceof Error ? cause.message : "无法加载更多搜索结果。");
      }
    } finally {
      if (requestGeneration.current === generation) {
        setLoadingMore(false);
        activeRequest.current = null;
      }
    }
  }

  return (
    <section className="min-w-0">
      <div role="tablist" aria-label="搜索结果类型" className="hide-scrollbar flex max-w-full gap-2 overflow-x-auto pb-2">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`search-tab-${tab.id}`}
            role="tab"
            aria-selected={type === tab.value}
            aria-controls="search-results-panel"
            tabIndex={type === tab.value ? 0 : -1}
            type="button"
            onClick={() => selectType(tab.value)}
            onKeyDown={(event) => handleTabKey(event, index)}
            className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-black ${
              type === tab.value ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-[var(--line)] muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id="search-results-panel"
        role="tabpanel"
        aria-labelledby={`search-tab-${selectedTab.id}`}
        aria-busy={isPending || loadingMore}
        tabIndex={0}
      >
        {isPending ? (
          <div role="status" className="mt-5 space-y-3">
            {[0, 1, 2].map((item) => <div key={item} className="glass h-28 animate-pulse rounded-lg" />)}
            <span className="sr-only">正在切换搜索类型</span>
          </div>
        ) : !query ? (
          <div className="glass mt-5 rounded-lg px-5 py-16 text-center">
            <Search className="mx-auto muted" />
            <h2 className="mt-4 font-black">输入至少两个字符开始搜索</h2>
            <p className="mt-2 text-sm muted">可搜索公开作品、创作者与安全的频道资料。</p>
          </div>
        ) : error && data.results.length === 0 ? (
          <div role="alert" className="glass mt-5 rounded-lg px-5 py-16 text-center">
            <h2 className="font-black">搜索暂时失败</h2>
            <p className="mt-2 text-sm text-red-500">{error}</p>
          </div>
        ) : data.results.length === 0 ? (
          <div className="glass mt-5 rounded-lg px-5 py-16 text-center">
            <h2 className="font-black">没有找到相关结果</h2>
            <p className="mt-2 text-sm muted">尝试更短的关键词或其他结果类型。</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {data.results.map((result) => {
              const Icon = icons[result.entityType];
              return (
                <Link
                  key={`${result.entityType}:${result.entityId}`}
                  href={result.href}
                  data-testid="search-result"
                  data-result-id={result.entityId}
                  data-result-type={result.entityType}
                  className="glass flex min-w-0 items-start gap-4 rounded-lg p-4 transition hover:-translate-y-0.5 sm:p-5"
                >
                  <span
                    title={result.entityType === "post" ? "作品" : result.entityType === "creator" ? "创作者" : "频道"}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-violet/10 text-violet"
                  >
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-black sm:text-lg">{result.title}</span>
                    <span className="mt-1 line-clamp-2 block break-words text-sm leading-6 muted">{result.summary}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {error && data.results.length > 0 && <p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
      {data.nextCursor && !isPending && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          aria-label="加载更多搜索结果"
          className="mx-auto mt-6 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-5 text-sm font-black disabled:opacity-60"
        >
          <Plus size={17} />
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      )}
    </section>
  );
}
