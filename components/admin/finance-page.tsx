"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const ADMIN_FINANCE_TABS = ["orders", "payments", "refunds", "payouts", "kyc", "reconciliation"] as const;
export type AdminFinanceTab = (typeof ADMIN_FINANCE_TABS)[number];
export type FinanceRow = {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  provider?: string;
  channel?: string;
  legalName?: string;
  countryCode?: string;
  paymentCount?: number;
  ledgerCount?: number;
  walletCount?: number;
  discrepancyCount?: number;
  startedAt?: string;
  createdAt?: string;
  referenceType?: string;
  referenceId?: string;
  type?: string;
  kind?: string;
  itemId?: string;
  orderId?: string;
  orderStatus?: string;
  source?: string;
  reason?: string;
  successfulPayment?: boolean;
  user?: { handle?: string; name?: string };
};

export type FinanceRowPatch<T extends { id: string }> = { rowId: string; patch: Partial<T>; remove: boolean };

type RequestError = Error & { status?: number };

const TAB_ENDPOINTS: Record<AdminFinanceTab, string> = {
  orders: "/api/admin/finance/transactions",
  payments: "/api/admin/finance/ledger",
  refunds: "/api/admin/finance/transactions",
  payouts: "/api/admin/finance/payout-requests",
  kyc: "/api/admin/finance/kyc-cases",
  reconciliation: "/api/admin/finance/reconciliation"
};

const TAB_LABELS: Record<AdminFinanceTab, string> = {
  orders: "订单",
  payments: "支付与结算",
  refunds: "退款",
  payouts: "提现",
  kyc: "KYC",
  reconciliation: "对账"
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`) as RequestError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function adminFinanceListUrl(tab: AdminFinanceTab, params: URLSearchParams) {
  const query = new URLSearchParams();
  if (tab === "orders" || tab === "refunds") query.set("view", tab);
  const status = params.get("status")?.trim();
  if (status) query.set("status", status);
  const endpoint = TAB_ENDPOINTS[tab];
  return `${endpoint}${query.size ? `?${query}` : ""}`;
}

export async function loadAdminFinance(tab: AdminFinanceTab, params: URLSearchParams, fetcher: Fetcher = fetch) {
  return readJson<Record<string, unknown>>(await fetcher(adminFinanceListUrl(tab, params)));
}

export async function requestFinanceRowPatch<T extends { id: string }>(
  rowId: string,
  url: string,
  init: RequestInit,
  selectPatch: (body: unknown) => Partial<T>,
  fetcher: Fetcher = fetch,
  remove = false
): Promise<FinanceRowPatch<T>> {
  const body = await readJson<unknown>(await fetcher(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  }));
  const patch = selectPatch(body);
  return { rowId, patch, remove };
}

export function applyFinanceRowPatch<T extends { id: string }>(rows: readonly T[], result: FinanceRowPatch<T>) {
  if (result.remove) return rows.filter((row) => row.id !== result.rowId);
  return rows.map((row) => row.id === result.rowId ? { ...row, ...result.patch } : row);
}

export function financeRowsForTab(tab: AdminFinanceTab, body: Record<string, unknown>) {
  const key = tab === "orders" ? "orders" : tab === "refunds" ? "refunds" : tab === "payouts" ? "payouts" : tab === "kyc" ? "cases" : tab === "reconciliation" ? "runs" : "transactions";
  const rows = Array.isArray(body[key]) ? body[key] as FinanceRow[] : [];
  if (tab !== "orders") return rows;
  const unique = new Map<string, FinanceRow>();
  for (const row of rows) {
    if (!["refunded", "charged_back"].includes(row.status ?? "") && !unique.has(row.id)) unique.set(row.id, row);
  }
  return [...unique.values()];
}

export function canRefundFinanceOrder(row: FinanceRow) {
  return !row.orderId && ["paid", "fulfilled"].includes(row.status ?? "") && row.successfulPayment === true;
}

export function financeColumnsForTab(tab: AdminFinanceTab) {
  if (tab === "reconciliation") return [
    { key: "time", header: "时间" },
    { key: "payments", header: "支付" },
    { key: "ledger", header: "账本" },
    { key: "wallets", header: "钱包" },
    { key: "result", header: "结果" },
    { key: "operation", header: "操作" }
  ] as const;
  return [
    { key: "record", header: "记录" },
    { key: "amount", header: "金额 / 国家" },
    { key: "status", header: "状态" },
    { key: "detail", header: "详情" },
    { key: "operation", header: "操作" }
  ] as const;
}

function rowMatchesStatus(tab: AdminFinanceTab, row: FinanceRow, status: string) {
  if (!status) return true;
  if (tab === "reconciliation" && status === "exception") return (row.discrepancyCount ?? 0) > 0;
  return row.status === status;
}

export function FinancePage({
  initialTab,
  initialStatus = "",
  canWrite
}: {
  initialTab: AdminFinanceTab;
  initialStatus?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<FinanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryMutation, setRetryMutation] = useState<null | (() => Promise<void>)>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams();
    if (initialStatus) value.set("status", initialStatus);
    return value;
  }, [initialStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminFinance(initialTab, params);
      setRows(financeRowsForTab(initialTab, body).filter((row) => rowMatchesStatus(initialTab, row, initialStatus)));
    } catch (caught) {
      const requestError = caught as RequestError;
      if (requestError.status === 401) {
        router.replace("/admin/sign-in");
        return;
      }
      setError(requestError.status === 403 ? "当前管理员没有访问财务分区的权限。" : requestError.message || "无法加载财务数据。");
    } finally {
      setLoading(false);
    }
  }, [initialStatus, initialTab, params, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutateRow(
    rowId: string,
    url: string,
    init: RequestInit,
    selectPatch: (body: unknown) => Partial<FinanceRow>,
    successMessage: string,
    remove = false
  ) {
    const attempt = async () => {
      setError("");
      setMessage("");
      try {
        const result = await requestFinanceRowPatch(rowId, url, init, selectPatch, fetch, remove);
        setRows((current) => applyFinanceRowPatch(current, result));
        setMessage(successMessage);
        setRetryMutation(null);
      } catch (caught) {
        const requestError = caught as RequestError;
        if (requestError.status === 401) {
          router.replace("/admin/sign-in");
          return;
        }
        setError(requestError.status === 403 ? "当前管理员没有执行此财务操作的权限。" : requestError.message || "财务操作失败，请重试。");
        setRetryMutation(() => attempt);
      }
    };
    await attempt();
  }

  async function runAction(url: string, successMessage: string, selectRow?: (body: unknown) => FinanceRow | undefined) {
    const attempt = async () => {
      setError("");
      setMessage("");
      try {
        const body = await readJson<unknown>(await fetch(url, { method: "POST" }));
        const row = selectRow?.(body);
        if (row) setRows((current) => [row, ...current.filter((item) => item.id !== row.id)]);
        setMessage(successMessage);
        setRetryMutation(null);
      } catch (caught) {
        const requestError = caught as RequestError;
        if (requestError.status === 401) {
          router.replace("/admin/sign-in");
          return;
        }
        setError(requestError.status === 403 ? "当前管理员没有执行此财务操作的权限。" : requestError.message || "财务操作失败，请重试。");
        setRetryMutation(() => attempt);
      }
    };
    await attempt();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-black">订单与财务</h1>
        <p className="mt-2 text-sm muted">每个标签仅加载其财务职责范围内的数据。</p>
      </header>
      <nav aria-label="财务标签" className="mb-6 flex gap-2 overflow-x-auto border-b border-[var(--line)] pb-3">
        {ADMIN_FINANCE_TABS.map((tab) => {
          const query = new URLSearchParams({ tab });
          if (tab === initialTab && initialStatus) query.set("status", initialStatus);
          return <Link key={tab} href={`/admin/finance?${query}`} aria-current={tab === initialTab ? "page" : undefined} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${tab === initialTab ? "bg-[var(--text)] text-[var(--bg)]" : "border border-[var(--line)]"}`}>{TAB_LABELS[tab]}</Link>;
        })}
      </nav>

      {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error && rows.length ? <MutationError message={error} onRetry={retryMutation ?? (() => load())} /> : null}
      {loading && !rows.length ? <AdminPageState title={`正在加载${TAB_LABELS[initialTab]}…`} /> : null}
      {error && !rows.length ? <AdminPageState title={`无法加载${TAB_LABELS[initialTab]}`} message={error} onRetry={() => retryMutation ? void retryMutation() : void load()} /> : null}
      {!loading && !error && !rows.length ? <AdminPageState title={`暂无${TAB_LABELS[initialTab]}记录`} /> : null}
      {rows.length ? <FinanceTable tab={initialTab} rows={rows} canWrite={canWrite} mutateRow={mutateRow} /> : null}

      {canWrite && initialTab === "payments" ? <button type="button" onClick={() => void runAction("/api/admin/finance/settlements/run", "到期收入结算已完成。")} className="mt-4 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">运行到期结算</button> : null}
      {canWrite && initialTab === "reconciliation" ? <button type="button" onClick={() => void runAction("/api/admin/finance/reconciliation", "财务对账已完成。", (body) => (body as { run?: FinanceRow }).run)} className="mt-4 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">立即对账</button> : null}
    </div>
  );

  function FinanceTable({ tab, rows: tableRows, canWrite: writable, mutateRow: mutate }: {
    tab: AdminFinanceTab;
    rows: FinanceRow[];
    canWrite: boolean;
    mutateRow: typeof mutateRow;
  }) {
    const columns = financeColumnsForTab(tab);
    return (
      <>
        <div data-testid="finance-desktop-table" className="hidden md:block">
          <AdminTable headers={columns.map((column) => column.header)}>
            {tableRows.map((row) => tab === "reconciliation" ? (
              <tr key={row.id}>
                <td className="px-4 py-3 text-xs">{formatDate(row.startedAt ?? row.createdAt)}</td>
                <td className="px-4 py-3">{row.paymentCount ?? 0}</td>
                <td className="px-4 py-3">{row.ledgerCount ?? 0}</td>
                <td className="px-4 py-3">{row.walletCount ?? 0}</td>
                <td className="px-4 py-3"><AdminStatus tone={statusTone(row.status, row.discrepancyCount)}>{row.discrepancyCount ?? 0} 项差异</AdminStatus></td>
                <td className="px-4 py-3"><span className="text-xs muted">只读记录</span></td>
              </tr>
            ) : (
              <tr key={row.id}>
                <td className="px-4 py-3 font-black">{row.kind ?? row.legalName ?? row.type ?? row.user?.name ?? row.id}<p className="text-xs font-normal muted">{row.orderId ?? row.user?.handle ?? row.id}</p></td>
                <td className="px-4 py-3">{row.countryCode ?? `${row.currency ?? ""} ${row.amount ?? "—"}`}</td>
                <td className="px-4 py-3"><AdminStatus tone={statusTone(row.status, row.discrepancyCount)}>{row.status ?? "—"}</AdminStatus></td>
                <td className="px-4 py-3 text-xs muted">{row.provider ?? row.channel ?? row.source ?? row.referenceType ?? row.countryCode ?? "—"}</td>
                <td className="px-4 py-3"><FinanceActions tab={tab} row={row} canWrite={writable} mutate={mutate} /></td>
              </tr>
            ))}
          </AdminTable>
        </div>
        <div data-testid="finance-mobile-list" className="space-y-3 md:hidden">
          {tableRows.map((row) => <article key={row.id} className="rounded-2xl border border-[var(--line)] p-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-black">{row.kind ?? row.legalName ?? row.type ?? row.user?.name ?? (tab === "reconciliation" ? formatDate(row.startedAt) : row.id)}</h2><p className="text-xs muted">{row.orderId ?? row.id}</p></div><AdminStatus tone={statusTone(row.status, row.discrepancyCount)}>{tab === "reconciliation" ? `${row.discrepancyCount ?? 0} 项差异` : row.status ?? "—"}</AdminStatus></div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{tab === "reconciliation" ? <><div><dt className="muted">支付</dt><dd>{row.paymentCount ?? 0}</dd></div><div><dt className="muted">账本</dt><dd>{row.ledgerCount ?? 0}</dd></div><div><dt className="muted">钱包</dt><dd>{row.walletCount ?? 0}</dd></div></> : <><div><dt className="muted">金额 / 国家</dt><dd>{row.countryCode ?? `${row.currency ?? ""} ${row.amount ?? "—"}`}</dd></div><div><dt className="muted">详情</dt><dd>{row.provider ?? row.channel ?? row.source ?? "—"}</dd></div></>}</dl>
            <div className="mt-3"><FinanceActions tab={tab} row={row} canWrite={writable} mutate={mutate} /></div>
          </article>)}
        </div>
      </>
    );
  }
}

function FinanceActions({ tab, row, canWrite, mutate }: {
  tab: AdminFinanceTab;
  row: FinanceRow;
  canWrite: boolean;
  mutate: (
    rowId: string,
    url: string,
    init: RequestInit,
    selectPatch: (body: unknown) => Partial<FinanceRow>,
    successMessage: string,
    remove?: boolean
  ) => Promise<void>;
}) {
  if (!canWrite) return <span className="text-xs muted">只读</span>;
  if (tab === "orders" && canRefundFinanceOrder(row)) {
    return <button type="button" onClick={() => void mutate(row.id, `/api/admin/finance/orders/${row.id}/refund`, { method: "POST", body: JSON.stringify({ reason: "财务后台全额退款" }) }, () => ({}), "订单已退款，访问权限已撤销。", true) } className="rounded-lg border border-rose-500 px-2 py-1 text-xs font-bold text-rose-700">全额退款</button>;
  }
  if (tab === "payouts") {
    const nextStatuses = row.status === "pending" ? (["approved", "rejected"] as const) : row.status === "approved" ? (["paid"] as const) : [];
    return <div className="flex flex-wrap gap-2">{nextStatuses.map((status) => <button key={status} type="button" onClick={() => void mutate(row.id, "/api/admin/finance/payout-requests", { method: "PATCH", body: JSON.stringify({ id: row.id, status, reviewNote: "由财务后台审核" }) }, (body) => (body as { payout: Partial<FinanceRow> }).payout, `提现申请已更新为 ${status}。`)} className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">{status === "approved" ? "通过" : status === "rejected" ? "拒绝" : "标记已付款"}</button>)}</div>;
  }
  if (tab === "kyc" && row.status === "pending") {
    return <div className="flex gap-2">{(["approved", "rejected"] as const).map((status) => <button key={status} type="button" onClick={() => void mutate(row.id, "/api/admin/finance/kyc-cases", { method: "PATCH", body: JSON.stringify({ id: row.id, status, reviewNote: "由财务后台审核" }) }, (body) => (body as { case: Partial<FinanceRow> }).case, `KYC 已${status === "approved" ? "通过" : "拒绝"}。`)} className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">{status === "approved" ? "通过" : "拒绝"}</button>)}</div>;
  }
  return <span className="text-xs muted">无需操作</span>;
}

function MutationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700"><span>{message}</span><button type="button" onClick={onRetry} className="rounded-lg border border-rose-500 px-3 py-1 font-bold">重试</button></div>;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function statusTone(status?: string, discrepancies?: number): "neutral" | "success" | "warning" | "danger" {
  if ((discrepancies ?? 0) > 0 || status === "rejected" || status === "failed") return "danger";
  if (["approved", "paid", "succeeded", "completed", "refunded"].includes(status ?? "")) return "success";
  if (status === "pending") return "warning";
  return "neutral";
}
