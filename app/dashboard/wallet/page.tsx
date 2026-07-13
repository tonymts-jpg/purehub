"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";
import { useDemoStore } from "@/lib/store";

type ServerTransaction = { id: string; title: string; amount: number; date: string; status: string };
type DashboardSummary = { balance: number; pending: number; transactions: ServerTransaction[] };

export default function WalletPage() {
  const { balance, transactions, payout } = useDemoStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1000");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/summary?creatorId=c1")
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (body) setSummary({ balance: body.balance ?? 0, pending: body.pending ?? 0, transactions: body.transactions ?? [] });
      })
      .catch(() => setSummary(null));
  }, []);

  const visibleBalance = summary?.balance ?? balance;
  const visiblePending = summary?.pending ?? 1840;
  const visibleTransactions = useMemo(() => summary?.transactions ?? transactions, [summary, transactions]);

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 100) {
      setError("最低提现金额为 ¥100");
      return;
    }

    try {
      const response = await fetch("/api/payout-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "c1", amount: n, channel: "alipay" })
      });
      if (!response.ok) throw new Error("server payout failed");
    } catch {
      if (!payout(n)) {
        setError(n < 100 ? "最低提现金额为 ¥100" : "可用余额不足");
        return;
      }
    }

    setOpen(false);
    setError("");
  };

  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <PageHeader title="钱包与提现" subtitle="Phase 4: creator wallet, pending settlement, and payout review."/>
    <DashboardNav/>

    <section className="relative overflow-hidden rounded-[34px] bg-ink p-7 text-white shadow-2xl sm:p-10">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-violet/40 blur-3xl"/>
      <div className="relative">
        <p className="flex items-center gap-2 text-sm text-white/60"><WalletCards size={17}/>可用余额</p>
        <p className="mt-3 text-5xl font-black">¥{visibleBalance.toLocaleString()}</p>
        <p className="mt-2 text-sm text-white/55">另有 ¥{visiblePending.toLocaleString()} 待结算</p>
        <button onClick={() => setOpen(true)} className="mt-7 rounded-full bg-white px-6 py-3 text-sm font-black text-ink">申请提现</button>
      </div>
    </section>

    <section className="glass mt-6 rounded-[30px] p-6">
      <h2 className="font-black">交易明细</h2>
      <div className="mt-5 divide-y divide-[var(--line)]">{visibleTransactions.map((transaction) => <div key={transaction.id} className="flex items-center gap-4 py-4">
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${transaction.amount > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-coral/10 text-coral"}`}>{transaction.amount > 0 ? <ArrowUpRight/> : <ArrowDownRight/>}</span>
        <div className="flex-1">
          <p className="text-sm font-black">{transaction.title}</p>
          <p className="text-xs muted">{transaction.date} · {transaction.status}</p>
        </div>
        <b>{transaction.amount > 0 ? "+" : ""}¥{Math.abs(transaction.amount)}</b>
      </div>)}</div>
    </section>

    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-[30px] p-7">
        <span className="brand-gradient grid h-12 w-12 place-items-center rounded-2xl text-white"><CircleDollarSign/></span>
        <h2 className="mt-5 text-2xl font-black">申请提现</h2>
        <p className="mt-1 text-sm muted">提交后进入 finance admin review。</p>
        <label className="mt-6 block text-xs font-bold muted">提现金额</label>
        <div className="mt-2 flex items-center rounded-2xl border border-[var(--line)] px-4">
          <span className="text-xl font-black">¥</span>
          <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full bg-transparent p-4 text-2xl font-black outline-none"/>
        </div>
        {error && <p className="mt-2 text-xs text-coral">{error}</p>}
        <p className="mt-3 text-xs muted">可提现 ¥{visibleBalance.toLocaleString()} · 最低 ¥100</p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => setOpen(false)} className="flex-1 rounded-full border border-[var(--line)] py-3 font-bold">取消</button>
          <button onClick={submit} className="brand-gradient flex-1 rounded-full py-3 font-bold text-white">确认申请</button>
        </div>
      </div>
    </div>}
  </div>;
}
