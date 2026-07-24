"use client";

import Link from "next/link";
import { FileText, Radio, Search, UserRound, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/lib/channels/types";

type ResultType = "post" | "creator" | "channel";
type SearchPage = { results: SearchResult[]; nextCursor: string | null };

const tabs: Array<{ value: ResultType | null; label: string }> = [
  { value: null, label: "全部" },
  { value: "post", label: "作品" },
  { value: "creator", label: "创作者" },
  { value: "channel", label: "频道" }
];

const icons = {
  post: FileText,
  creator: UserRound,
  channel: Radio
};

export function SearchResults({ query, type }: { query: string; type: ResultType | null }) {
  const router = useRouter();
  const [data, setData] = useState<SearchPage>({ results: [], nextCursor: null });
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) {
      setData({ results: [], nextCursor: null });
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: "6" });
    if (type) params.set("type", type);
    setLoading(true);
    setError("");
    fetch(`/api/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) return response.json();
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "搜索服务暂时无法使用。");
      })
      .then((body: SearchPage) => setData(body))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setData({ results: [], nextCursor: null });
        setError(cause instanceof Error ? cause.message : "搜索服务暂时无法使用。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query, type]);

  function selectType(nextType: ResultType | null) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextType) params.set("type", nextType);
    router.push(`/search?${params}`);
  }

  async function loadMore() {
    if (!data.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    const params = new URLSearchParams({ q: query, limit: "6", cursor: data.nextCursor });
    if (type) params.set("type", type);
    try {
      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) throw new Error("无法加载更多搜索结果。");
      const body = await response.json() as SearchPage;
      setData((current) => {
        const known = new Set(current.results.map((item) => `${item.entityType}:${item.entityId}`));
        return {
          results: [...current.results, ...body.results.filter((item) => !known.has(`${item.entityType}:${item.entityId}`))],
          nextCursor: body.nextCursor
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载更多搜索结果。");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="min-w-0">
      <div role="tablist" aria-label="搜索结果类型" className="hide-scrollbar flex max-w-full gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            role="tab"
            aria-selected={type === tab.value}
            type="button"
            onClick={() => selectType(tab.value)}
            className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-black ${
              type === tab.value ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-[var(--line)] muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!query ? (
        <div className="glass mt-5 rounded-lg px-5 py-16 text-center">
          <Search className="mx-auto muted" />
          <h2 className="mt-4 font-black">输入至少两个字符开始搜索</h2>
          <p className="mt-2 text-sm muted">可搜索公开作品、创作者与安全的频道资料。</p>
        </div>
      ) : loading ? (
        <div role="status" className="mt-5 space-y-3">
          {[0, 1, 2].map((item) => <div key={item} className="glass h-28 animate-pulse rounded-lg" />)}
          <span className="sr-only">正在搜索</span>
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

      {error && data.results.length > 0 && <p role="alert" className="mt-4 text-sm font-semibold text-red-500">{error}</p>}
      {data.nextCursor && (
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
