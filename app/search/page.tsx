import { headers } from "next/headers";
import { SearchExperience } from "@/components/search/search-experience";
import type { SearchResult } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

type ResultType = "post" | "creator" | "channel";
type SearchPage = { results: SearchResult[]; nextCursor: string | null };

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function fetchInitialSearch(
  query: string,
  type: ResultType | null
): Promise<{ page: SearchPage; error: string }> {
  if (!query) return { page: { results: [], nextCursor: null }, error: "" };
  if (query.length < 2 || query.length > 100) {
    return {
      page: { results: [], nextCursor: null },
      error: "搜索关键词必须为 2 至 100 个字符。"
    };
  }
  const requestHeaders = await headers();
  const port = process.env.PORT ?? "3000";
  const params = new URLSearchParams({ q: query, limit: "6" });
  if (type) params.set("type", type);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/search?${params}`, {
      cache: "no-store",
      headers: { cookie: requestHeaders.get("cookie") ?? "" }
    });
    if (!response.ok) throw new Error("Search request failed.");
    return { page: await response.json() as SearchPage, error: "" };
  } catch {
    return {
      page: { results: [], nextCursor: null },
      error: "搜索服务暂时无法使用。"
    };
  }
}

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = single(params.q).trim();
  const candidateType = single(params.type);
  const type: ResultType | null = candidateType === "post"
    || candidateType === "creator"
    || candidateType === "channel"
    ? candidateType
    : null;
  const initial = await fetchInitialSearch(query, type);
  return (
    <SearchExperience
      query={query}
      type={type}
      initialPage={initial.page}
      initialError={initial.error}
    />
  );
}
