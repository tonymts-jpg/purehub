"use client";

import { useEffect, useState } from "react";
import { Activity, BadgeDollarSign, ClipboardList, CreditCard, Layers3, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import type { AdminRole } from "@/lib/platform-config";

type Overview = {
  metrics: { users: number; creators: number; pendingApplications: number; posts: number; transactions: number; payouts: number };
  activePricingVersion?: { id: string; name: string; status: string } | null;
  admin: { role: AdminRole; permissions: string[] };
};
type UserRow = { id: string; name: string; handle: string; role: string; creatorStatus: string; creatorProfile?: { followers: number; members: number; levelId: string | null } | null };
type ApplicationRow = { id: string; displayName: string; category: string; contact: string; status: string; user: { handle: string } };
type LevelRow = { id: string; name: string; minFollowers: number; maxFollowers: number | null; _count?: { creators: number } };
type PricingVersion = { id: string; name: string; status: string; tiers: Array<{ id: string; levelId: string; contentType: string; saleMode: string; price: number; currency: string }> };
type PaymentChannel = { provider: string; enabled: boolean; mode: string; currencies: string[]; regions: string[]; feeNote: string; statusNote: string };
type FeeConfig = { id: string; name: string; feeBps: number; status: string };
type FinanceTransaction = { id: string; amount: number; currency: string; status: string; platformFeeBps: number; platformFeeAmount: number; creatorNetAmount: number; order: { id: string; kind: string; buyerUserId: string; creatorUserId: string } };
type PayoutRequest = { id: string; amount: number; status: string; channel: string; user: { handle: string } };
type SettlementConfig = { id: string; name: string; holdDays: number; status: string };
type KycCase = { id: string; status: string; legalName: string; countryCode: string; user: { handle: string; name: string } };
type ReconciliationRun = { id: string; status: string; paymentCount: number; ledgerCount: number; walletCount: number; discrepancyCount: number; startedAt: string };
type AuditLog = { id: string; actorRole: string; action: string; targetType: string; targetId: string; createdAt: string };

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [versions, setVersions] = useState<PricingVersion[]>([]);
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [feeConfigs, setFeeConfigs] = useState<FeeConfig[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<FinanceTransaction[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [settlementConfigs, setSettlementConfigs] = useState<SettlementConfig[]>([]);
  const [kycCases, setKycCases] = useState<KycCase[]>([]);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [message, setMessage] = useState("正在验证管理员会话。");

  const headers = { "content-type": "application/json" };

  async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function loadAdmin() {
    try {
      const [overviewBody, usersBody, applicationsBody, levelsBody, pricingBody, paymentsBody, feeBody, financeBody, payoutBody, settlementBody, kycBody, reconciliationBody, auditBody] = await Promise.all([
        adminFetch<Overview>("/api/admin/overview"),
        adminFetch<{ users: UserRow[] }>("/api/admin/users").catch(() => ({ users: [] })),
        adminFetch<{ applications: ApplicationRow[] }>("/api/admin/creator-applications").catch(() => ({ applications: [] })),
        adminFetch<{ levels: LevelRow[] }>("/api/admin/creator-levels").catch(() => ({ levels: [] })),
        adminFetch<{ versions: PricingVersion[] }>("/api/admin/pricing/versions").catch(() => ({ versions: [] })),
        adminFetch<{ channels: PaymentChannel[] }>("/api/admin/payment-channels").catch(() => ({ channels: [] })),
        adminFetch<{ configs: FeeConfig[] }>("/api/admin/finance/fee-configs").catch(() => ({ configs: [] })),
        adminFetch<{ transactions: FinanceTransaction[] }>("/api/admin/finance/transactions").catch(() => ({ transactions: [] })),
        adminFetch<{ payouts: PayoutRequest[] }>("/api/admin/finance/payout-requests").catch(() => ({ payouts: [] })),
        adminFetch<{ configs: SettlementConfig[] }>("/api/admin/finance/settlement-configs").catch(() => ({ configs: [] })),
        adminFetch<{ cases: KycCase[] }>("/api/admin/finance/kyc-cases").catch(() => ({ cases: [] })),
        adminFetch<{ runs: ReconciliationRun[] }>("/api/admin/finance/reconciliation").catch(() => ({ runs: [] })),
        adminFetch<{ logs: AuditLog[] }>("/api/admin/audit-logs").catch(() => ({ logs: [] }))
      ]);
      setOverview(overviewBody);
      setUsers(usersBody.users);
      setApplications(applicationsBody.applications);
      setLevels(levelsBody.levels);
      setVersions(pricingBody.versions);
      setChannels(paymentsBody.channels);
      setFeeConfigs(feeBody.configs);
      setFinanceTransactions(financeBody.transactions);
      setPayouts(payoutBody.payouts);
      setSettlementConfigs(settlementBody.configs);
      setKycCases(kycBody.cases);
      setReconciliationRuns(reconciliationBody.runs);
      setLogs(auditBody.logs);
      setMessage("站务数据已同步。");
    } catch (error) {
      setMessage(`无法加载站务数据：${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  useEffect(() => {
    void loadAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function review(id: string, status: "approved" | "rejected") {
    await adminFetch(`/api/admin/creator-applications/${id}/review`, { method: "POST", body: JSON.stringify({ status }) });
    setMessage(`申请已${status === "approved" ? "通过" : "拒绝"}。`);
    await loadAdmin();
  }

  async function createDraftVersion() {
    const active = versions.find((version) => version.status === "active") ?? versions[0];
    const body = await adminFetch<{ version: PricingVersion }>("/api/admin/pricing/versions", {
      method: "POST",
      body: JSON.stringify({ name: `Admin draft ${new Date().toLocaleString()}`, copyFromVersionId: active?.id })
    });
    setMessage(`已建立草稿价格版本：${body.version.name}`);
    await loadAdmin();
  }

  async function publishVersion(id: string) {
    await adminFetch(`/api/admin/pricing/versions/${id}/publish`, { method: "POST" });
    setMessage("价格版本已发布，新作品将使用最新档位。");
    await loadAdmin();
  }

  async function toggleUsdt() {
    const usdt = channels.find((channel) => channel.provider === "usdt");
    await adminFetch("/api/admin/payment-channels/usdt", {
      method: "PATCH",
      body: JSON.stringify({ enabled: !usdt?.enabled, mode: usdt?.mode ?? "test", statusNote: "updated_from_admin_dashboard" })
    });
    setMessage("USDT 支付渠道状态已更新。");
    await loadAdmin();
  }

  async function createFeeConfig() {
    const nextFee = feeConfigs.find((config) => config.status === "active")?.feeBps === 1500 ? 1000 : 1500;
    const body = await adminFetch<{ config: FeeConfig }>("/api/admin/finance/fee-configs", {
      method: "POST",
      body: JSON.stringify({ name: `Finance fee ${nextFee / 100}%`, feeBps: nextFee })
    });
    await adminFetch(`/api/admin/finance/fee-configs/${body.config.id}/activate`, { method: "POST" });
    setMessage(`平台抽成已更新为 ${nextFee / 100}%。`);
    await loadAdmin();
  }

  async function reviewPayout(id: string, status: "approved" | "rejected") {
    await adminFetch("/api/admin/finance/payout-requests", {
      method: "PATCH",
      body: JSON.stringify({ id, status, reviewNote: `Reviewed from admin dashboard as ${status}` })
    });
    setMessage(`提现申请已${status === "approved" ? "通过" : "拒绝"}。`);
    await loadAdmin();
  }

  async function markPayoutPaid(id: string) {
    await adminFetch("/api/admin/finance/payout-requests", { method: "PATCH", body: JSON.stringify({ id, status: "paid", reviewNote: "Payout completed from finance dashboard" }) });
    setMessage("Payout marked as paid and reserved funds moved to clearing.");
    await loadAdmin();
  }

  async function createSettlementConfig() {
    const holdDays = settlementConfigs.find((config) => config.status === "active")?.holdDays === 14 ? 7 : 14;
    const body = await adminFetch<{ config: SettlementConfig }>("/api/admin/finance/settlement-configs", { method: "POST", body: JSON.stringify({ name: `Settlement ${holdDays} days`, holdDays }) });
    await adminFetch(`/api/admin/finance/settlement-configs/${body.config.id}/activate`, { method: "POST" });
    setMessage(`Settlement hold updated to ${holdDays} days.`);
    await loadAdmin();
  }

  async function reviewKyc(id: string, status: "approved" | "rejected") {
    await adminFetch("/api/admin/finance/kyc-cases", { method: "PATCH", body: JSON.stringify({ id, status, reviewNote: `Reviewed from finance dashboard: ${status}` }) });
    setMessage(`KYC case ${status}.`);
    await loadAdmin();
  }

  async function refund(orderId: string) {
    await adminFetch(`/api/admin/finance/orders/${orderId}/refund`, { method: "POST", body: JSON.stringify({ reason: "Finance dashboard full refund" }) });
    setMessage("Order refunded and access revoked.");
    await loadAdmin();
  }

  async function runReconciliation() {
    await adminFetch("/api/admin/finance/reconciliation", { method: "POST" });
    setMessage("Finance reconciliation completed.");
    await loadAdmin();
  }

  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <PageHeader title="站务后台" subtitle="Phase 5：支付、平衡账本、结算、退款、KYC、对账与私有媒体运营。"/>
    <section className="mb-6 flex flex-wrap items-center gap-3 border-y border-[var(--line)] py-4">
      <button onClick={loadAdmin} className="self-end rounded-md bg-[var(--text)] px-4 py-2 text-sm font-black text-[var(--bg)]">同步</button>
      <p role="status" className="text-sm muted">{message}</p>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric icon={Users} label="用户" value={overview?.metrics.users ?? 0}/>
      <Metric icon={ShieldCheck} label="博主" value={overview?.metrics.creators ?? 0}/>
      <Metric icon={ClipboardList} label="待审申请" value={overview?.metrics.pendingApplications ?? 0}/>
      <Metric icon={Layers3} label="作品" value={overview?.metrics.posts ?? 0}/>
      <Metric icon={BadgeDollarSign} label="交易" value={overview?.metrics.transactions ?? 0}/>
      <Metric icon={Activity} label="提現" value={overview?.metrics.payouts ?? 0}/>
    </div>

    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <Panel title="博主申请" icon={ClipboardList}>
        <Table headers={["申请人", "分类", "状态", "操作"]}>
          {applications.slice(0, 8).map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.displayName}<p className="text-xs muted">@{item.user.handle}</p></td>
            <td className="px-3 py-2">{item.category}</td>
            <td className="px-3 py-2"><Status text={item.status}/></td>
            <td className="px-3 py-2">
              <button disabled={item.status !== "pending"} onClick={() => review(item.id, "approved")} className="mr-2 rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">通过</button>
              <button disabled={item.status !== "pending"} onClick={() => review(item.id, "rejected")} className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">拒绝</button>
            </td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="用户管理" icon={Users}>
        <Table headers={["用户", "角色", "博主状态", "等级/粉丝"]}>
          {users.slice(0, 10).map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.name}<p className="text-xs muted">@{item.handle}</p></td>
            <td className="px-3 py-2">{item.role}</td>
            <td className="px-3 py-2"><Status text={item.creatorStatus}/></td>
            <td className="px-3 py-2">{item.creatorProfile?.levelId ?? "-"}<p className="text-xs muted">{item.creatorProfile?.followers ?? 0} fans</p></td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="博主等级" icon={Layers3}>
        <Table headers={["等级", "粉丝区间", "博主数"]}>
          {levels.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.name}<p className="text-xs muted">{item.id}</p></td>
            <td className="px-3 py-2">{item.minFollowers.toLocaleString()} - {item.maxFollowers?.toLocaleString() ?? "∞"}</td>
            <td className="px-3 py-2">{item._count?.creators ?? 0}</td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="价格版本" icon={BadgeDollarSign} testId="admin-pricing-panel" action={<button onClick={createDraftVersion} className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-bold">建草稿</button>}>
        <Table headers={["版本", "状态", "档位数", "操作"]}>
          {versions.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.name}<p className="text-xs muted">{item.id}</p></td>
            <td className="px-3 py-2"><Status text={item.status}/></td>
            <td className="px-3 py-2">{item.tiers.length}</td>
            <td className="px-3 py-2"><button disabled={item.status === "active"} onClick={() => publishVersion(item.id)} className="rounded-md bg-[var(--text)] px-2 py-1 text-xs font-bold text-[var(--bg)] disabled:opacity-40">发布</button></td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="支付渠道" icon={CreditCard} action={<button onClick={toggleUsdt} className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-bold">切换 USDT</button>}>
        <Table headers={["渠道", "模式", "状态", "提示"]}>
          {channels.map((item) => <tr key={item.provider}>
            <td className="px-3 py-2 font-bold">{item.provider}</td>
            <td className="px-3 py-2">{item.mode}</td>
            <td className="px-3 py-2"><Status text={item.enabled ? "enabled" : "disabled"}/></td>
            <td className="px-3 py-2 text-xs muted">{item.statusNote}</td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="平台抽成" icon={BadgeDollarSign} action={<button onClick={createFeeConfig} className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-bold">切换 10/15%</button>}>
        <Table headers={["名称", "比例", "状态", "ID"]}>
          {feeConfigs.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.name}</td>
            <td className="px-3 py-2">{item.feeBps / 100}%</td>
            <td className="px-3 py-2"><Status text={item.status}/></td>
            <td className="px-3 py-2 text-xs muted">{item.id}</td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="财务交易" icon={BadgeDollarSign}>
        <Table headers={["订单", "总额", "平台抽成", "博主净收入", "操作"]}>
          {financeTransactions.slice(0, 8).map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.order.kind}<p className="text-xs muted">{item.order.id}</p></td>
            <td className="px-3 py-2">{item.currency} {item.amount}</td>
            <td className="px-3 py-2">{item.platformFeeAmount}<p className="text-xs muted">{item.platformFeeBps / 100}%</p></td>
            <td className="px-3 py-2">{item.creatorNetAmount}</td>
            <td className="px-3 py-2"><button disabled={item.status !== "succeeded"} onClick={() => refund(item.order.id)} className="rounded-md border border-rose-500 px-2 py-1 text-xs font-bold text-rose-600 disabled:opacity-40">全额退款</button></td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="提现审核" icon={Activity}>
        <Table headers={["博主", "金额", "状态", "操作"]}>
          {payouts.slice(0, 8).map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">@{item.user.handle}<p className="text-xs muted">{item.channel}</p></td>
            <td className="px-3 py-2">{item.amount}</td>
            <td className="px-3 py-2"><Status text={item.status}/></td>
            <td className="px-3 py-2">
              <button disabled={item.status !== "pending"} onClick={() => reviewPayout(item.id, "approved")} className="mr-2 rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">通过</button>
              <button disabled={item.status !== "pending"} onClick={() => reviewPayout(item.id, "rejected")} className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">拒绝</button>
              <button disabled={item.status !== "approved"} onClick={() => markPayoutPaid(item.id)} className="ml-2 rounded-md border border-[var(--line)] px-2 py-1 text-xs font-bold disabled:opacity-40">已付款</button>
            </td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="结算规则" icon={Activity} action={<button onClick={createSettlementConfig} className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-bold">切换 7/14 天</button>}>
        <Table headers={["名称", "冻结天数", "状态", "ID"]}>
          {settlementConfigs.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.name}</td><td className="px-3 py-2">{item.holdDays}</td><td className="px-3 py-2"><Status text={item.status}/></td><td className="px-3 py-2 text-xs muted">{item.id}</td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="KYC 审核" icon={ShieldCheck}>
        <Table headers={["创作者", "国家", "状态", "操作"]}>
          {kycCases.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.legalName}<p className="text-xs muted">@{item.user.handle}</p></td><td className="px-3 py-2">{item.countryCode}</td><td className="px-3 py-2"><Status text={item.status}/></td>
            <td className="px-3 py-2"><button disabled={item.status !== "pending"} onClick={() => reviewKyc(item.id, "approved")} className="mr-2 rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">通过</button><button disabled={item.status !== "pending"} onClick={() => reviewKyc(item.id, "rejected")} className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">拒绝</button></td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="财务对账" icon={Activity} action={<button onClick={runReconciliation} className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-bold">立即对账</button>}>
        <Table headers={["时间", "支付", "账本", "钱包", "差异"]}>
          {reconciliationRuns.map((item) => <tr key={item.id}>
            <td className="px-3 py-2 text-xs">{new Date(item.startedAt).toLocaleString()}</td><td className="px-3 py-2">{item.paymentCount}</td><td className="px-3 py-2">{item.ledgerCount}</td><td className="px-3 py-2">{item.walletCount}</td><td className="px-3 py-2"><Status text={String(item.discrepancyCount)}/></td>
          </tr>)}
        </Table>
      </Panel>

      <Panel title="审计日志" icon={Activity}>
        <Table headers={["动作", "目标", "角色", "时间"]}>
          {logs.slice(0, 12).map((item) => <tr key={item.id}>
            <td className="px-3 py-2 font-bold">{item.action}</td>
            <td className="px-3 py-2">{item.targetType}:{item.targetId}</td>
            <td className="px-3 py-2">{item.actorRole}</td>
            <td className="px-3 py-2 text-xs muted">{new Date(item.createdAt).toLocaleString()}</td>
          </tr>)}
        </Table>
      </Panel>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-4">
    <Icon size={18} className="muted"/>
    <p className="mt-3 text-xs font-bold muted">{label}</p>
    <p className="text-2xl font-black">{value.toLocaleString()}</p>
  </div>;
}

function Panel({ title, icon: Icon, action, children, testId }: { title: string; icon: typeof Users; action?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return <section data-testid={testId} className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--card)] p-4">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-black"><Icon size={18}/>{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[520px] text-left text-sm">
      <thead><tr>{headers.map((header) => <th key={header} className="border-b border-[var(--line)] px-3 py-2 text-xs muted">{header}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function Status({ text }: { text: string }) {
  return <span className="inline-flex rounded-full bg-black/5 px-2 py-1 text-xs font-bold dark:bg-white/10">{text}</span>;
}
