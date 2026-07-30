"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountListState } from "@/components/account/account-list-state";
import { redirectToAccountSignIn } from "@/lib/account/client";

type ActivityListProps<T> = {
  endpoint: string;
  emptyTitle: string;
  emptyDescription: string;
  getKey: (item: T) => string;
  renderItem: (item: T, actions: { remove: () => void; reportError: (message: string) => void }) => ReactNode;
  childrenClassName?: string;
};

type AccountListResponse<T> = {
  items?: T[];
  nextCursor?: string | null;
  error?: string;
};

export function ActivityList<T>({
  endpoint,
  emptyTitle,
  emptyDescription,
  getKey,
  renderItem,
  childrenClassName
}: ActivityListProps<T>) {
  const pathname = usePathname();
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  function redirectForUnauthorized() {
    redirectToAccountSignIn(pathname, window.location.search);
  }

  async function request(cursor?: string) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const response = await fetch(cursor ? `${endpoint}${separator}cursor=${encodeURIComponent(cursor)}` : endpoint);
    if (response.status === 401) {
      redirectForUnauthorized();
      return null;
    }
    const body = await response.json().catch(() => null) as AccountListResponse<T> | null;
    if (!response.ok) throw new Error(body?.error || "暂时无法加载内容。");
    return body ?? {};
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const body = await request();
        if (!active || !body) return;
        setItems(body.items ?? []);
        setNextCursor(body.nextCursor ?? null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "暂时无法加载内容。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  // refresh intentionally retries the same stable endpoint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pathname, refresh]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const body = await request(nextCursor);
      if (!body) return;
      setItems((current) => [...current, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多内容。");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <AccountListState
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => setRefresh((value) => value + 1)}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      >
        <div className={childrenClassName}>
          {items.map((item) => {
            const key = getKey(item);
            return <div key={key}>{renderItem(item, {
              remove: () => setItems((current) => current.filter((candidate) => getKey(candidate) !== key)),
              reportError: setError
            })}</div>;
          })}
        </div>
      </AccountListState>
      {nextCursor && !loading && (
        <div className="mt-8 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">
            {loadingMore ? "正在加载…" : "加载更多"}
          </button>
        </div>
      )}
    </>
  );
}
