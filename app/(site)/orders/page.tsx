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
  const [refresh, setRefresh] = useState(0);

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

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const body = await request();
        if (!active || !body) return;
        setOrders(body.items ?? []);
        setNextCursor(body.nextCursor ?? null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "暂时无法加载订单。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  // refresh is a deliberate retry trigger for this fixed endpoint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, refresh]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const body = await request(nextCursor);
      if (!body) return;
      setOrders((current) => [...current, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多订单。");
    } finally {
      setLoadingMore(false);
    }
  }

  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title="订单" subtitle="查看你的作品购买和订阅订单。" />
    <AccountListState loading={loading} error={error} empty={orders.length === 0} onRetry={() => setRefresh((value) => value + 1)} emptyTitle="还没有订单" emptyDescription="购买作品或订阅创作者后，订单会显示在这里。">
      <OrderHistory orders={orders} />
    </AccountListState>
    {nextCursor && !loading && <div className="mt-8 text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">{loadingMore ? "正在加载…" : "加载更多"}</button></div>}
  </div>;
}
