"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { AccountListState } from "@/components/account/account-list-state";
import { OrderHistory } from "@/components/account/order-history";
import { redirectToAccountSignIn } from "@/lib/account/client";
import type { BuyerOrderListItem } from "@/lib/account/types";

type OrderResponse = { items?: BuyerOrderListItem[]; nextCursor?: string | null; error?: string };

export default function OrdersPage() {
  const pathname = usePathname();
  const [orders, setOrders] = useState<BuyerOrderListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedCursor, setFailedCursor] = useState<string | null | undefined>(undefined);

  async function request(cursor?: string) {
    const response = await fetch(cursor ? `/api/me/orders?cursor=${encodeURIComponent(cursor)}` : "/api/me/orders");
    if (response.status === 401) {
      redirectToAccountSignIn(pathname, window.location.search);
      return null;
    }
    const body = await response.json().catch(() => null) as OrderResponse | null;
    if (!response.ok) throw new Error(body?.error || "暂时无法加载订单。");
    return body ?? {};
  }

  async function load(cursor: string | null, replace: boolean) {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const body = await request(cursor ?? undefined);
      if (!body) return;
      setOrders((current) => replace ? (body.items ?? []) : [...current, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
      setFailedCursor(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多订单。");
      setFailedCursor(cursor);
    } finally {
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(null, true);
  // This account endpoint has no dynamic query input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    await load(nextCursor, false);
  }

  function retry() {
    if (failedCursor === undefined) return;
    void load(failedCursor, failedCursor === null);
  }

  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title="订单" subtitle="查看你的作品购买和订阅订单。" />
    <AccountListState loading={loading} error={error} empty={orders.length === 0} onRetry={retry} emptyTitle="还没有订单" emptyDescription="购买作品或订阅创作者后，订单会显示在这里。">
      <OrderHistory orders={orders} />
    </AccountListState>
    {nextCursor && !loading && <div className="mt-8 text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">{loadingMore ? "正在加载…" : "加载更多"}</button></div>}
  </div>;
}
