"use client";

import Link from "next/link";
import { Activity, ClipboardCheck, CreditCard, FileWarning, RadioTower, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminPageState } from "./admin-ui";

type Overview = {
  metrics: {
    users: number;
    creators: number;
    posts: number;
    transactions: number;
  };
  queues: {
    pendingApplications: number;
    pendingContent: number;
    pendingChannels: number;
    pendingRefunds: number;
    pendingPayouts: number;
    reconciliationExceptions: number;
  };
};

export const ADMIN_WORK_QUEUES = [
  { key: "pendingApplications", label: "待审创作者", href: "/admin/creators?status=pending", icon: Users },
  { key: "pendingContent", label: "待审内容", href: "/admin/content?status=pending", icon: ClipboardCheck },
  { key: "pendingChannels", label: "待审频道", href: "/admin/channels?status=pending", icon: RadioTower },
  { key: "pendingRefunds", label: "待处理退款", href: "/admin/finance?tab=refunds&status=pending", icon: CreditCard },
  { key: "pendingPayouts", label: "待处理提现", href: "/admin/finance?tab=payouts&status=pending", icon: Activity },
  { key: "reconciliationExceptions", label: "对账异常", href: "/admin/finance?tab=reconciliation&status=exception", icon: FileWarning }
] as const;

async function loadOverview() {
  const response = await fetch("/api/admin/overview");
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<Overview>;
}

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await loadOverview());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <DomainHeader title="站务概览" subtitle="只展示全站指标与跨域待办入口；具体操作在所属业务页面完成。" />
      {loading && !overview ? <AdminPageState title="正在加载站务概览…" /> : null}
      {error && !overview ? <AdminPageState title="无法加载站务概览" message={error} onRetry={() => void load()} /> : null}
      {overview ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="站务指标">
            <Metric label="会员" value={overview.metrics.users} />
            <Metric label="创作者" value={overview.metrics.creators} />
            <Metric label="内容" value={overview.metrics.posts} />
            <Metric label="交易" value={overview.metrics.transactions} />
          </section>

          <section data-testid="admin-work-queues" className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">工作队列</h2>
                <p className="mt-1 text-sm muted">每个入口保留精确筛选条件，可刷新、复制或分享。</p>
              </div>
              <button type="button" onClick={() => void load()} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-bold">
                刷新
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ADMIN_WORK_QUEUES.map(({ key, label, href, icon: Icon }) => (
                <Link key={key} href={href} className="flex items-center justify-between rounded-2xl border border-[var(--line)] p-4 hover:border-violet">
                  <span className="flex items-center gap-3 font-black"><Icon size={18} />{label}</span>
                  <span className="text-2xl font-black">{overview.queues[key]}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] p-4">
      <p className="text-xs font-bold uppercase tracking-[.14em] muted">{label}</p>
      <p className="mt-2 text-3xl font-black">{value.toLocaleString()}</p>
    </div>
  );
}

function DomainHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="mb-8"><h1 className="text-3xl font-black">{title}</h1><p className="mt-2 text-sm muted">{subtitle}</p></header>;
}
