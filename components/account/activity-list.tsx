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
  const [failedCursor, setFailedCursor] = useState<string | null | undefined>(undefined);

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

  async function load(cursor: string | null, replace: boolean) {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const body = await request(cursor ?? undefined);
      if (!body) return;
      setItems((current) => replace ? (body.items ?? []) : [...current, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
      setFailedCursor(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多内容。");
      setFailedCursor(cursor);
    } finally {
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(null, true);
  // Initial load is tied to the stable account endpoint and route identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pathname]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    await load(nextCursor, false);
  }

  function retry() {
    if (failedCursor === undefined) return;
    void load(failedCursor, failedCursor === null);
  }

  return (
    <>
      <AccountListState
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={retry}
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
