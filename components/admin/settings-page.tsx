"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type SettingsCapabilities = { finance: boolean; operations: boolean };
type SettingsGroup = "pricing" | "platform-fee" | "settlement-window" | "payment-channels";
type RequestError = Error & { status?: number };
type PricingVersion = { id: string; name: string; status: string; tiers?: unknown[] };
type FeeConfig = { id: string; name: string; feeBps: number; status: string };
type SettlementConfig = { id: string; name: string; holdDays: number; status: string };
type PaymentChannel = { provider: string; enabled: boolean; mode: string; statusNote?: string };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`) as RequestError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function settingsGroupsForCapabilities(capabilities: SettingsCapabilities): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  if (capabilities.operations) groups.push("pricing");
  if (capabilities.finance) groups.push("platform-fee", "settlement-window");
  if (capabilities.operations) groups.push("payment-channels");
  return groups;
}

export async function loadAdminSettings(capabilities: SettingsCapabilities, fetcher: Fetcher = fetch) {
  const requests: Array<Promise<{ key: SettingsGroup; body: Record<string, unknown> }>> = [];
  if (capabilities.operations) {
    requests.push(readJson<Record<string, unknown>>(await fetcher("/api/admin/pricing/versions")).then((body) => ({ key: "pricing", body })));
  }
  if (capabilities.finance) {
    requests.push(readJson<Record<string, unknown>>(await fetcher("/api/admin/finance/fee-configs")).then((body) => ({ key: "platform-fee", body })));
    requests.push(readJson<Record<string, unknown>>(await fetcher("/api/admin/finance/settlement-configs")).then((body) => ({ key: "settlement-window", body })));
  }
  if (capabilities.operations) {
    requests.push(readJson<Record<string, unknown>>(await fetcher("/api/admin/payment-channels")).then((body) => ({ key: "payment-channels", body })));
  }
  return Object.fromEntries((await Promise.all(requests)).map(({ key, body }) => [key, body])) as Partial<Record<SettingsGroup, Record<string, unknown>>>;
}

export function SettingsPage({ capabilities }: { capabilities: SettingsCapabilities }) {
  const router = useRouter();
  const groups = settingsGroupsForCapabilities(capabilities);
  const [versions, setVersions] = useState<PricingVersion[]>([]);
  const [fees, setFees] = useState<FeeConfig[]>([]);
  const [settlements, setSettlements] = useState<SettlementConfig[]>([]);
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryMutation, setRetryMutation] = useState<null | (() => Promise<void>)>(null);
  const hasRows = versions.length + fees.length + settlements.length + channels.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminSettings(capabilities);
      setVersions((body.pricing?.versions as PricingVersion[] | undefined) ?? []);
      setFees((body["platform-fee"]?.configs as FeeConfig[] | undefined) ?? []);
      setSettlements((body["settlement-window"]?.configs as SettlementConfig[] | undefined) ?? []);
      setChannels((body["payment-channels"]?.channels as PaymentChannel[] | undefined) ?? []);
    } catch (caught) {
      const requestError = caught as RequestError;
      if (requestError.status === 401) {
        router.replace("/admin/sign-in");
        return;
      }
      setError(requestError.status === 403 ? "当前管理员没有访问这些设置的权限。" : requestError.message || "无法加载平台设置。");
    } finally {
      setLoading(false);
    }
  }, [capabilities, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate<T>(attempt: () => Promise<T>, apply: (body: T) => void, successMessage: string) {
    const run = async () => {
      setError("");
      setMessage("");
      try {
        const body = await attempt();
        apply(body);
        setMessage(successMessage);
        setRetryMutation(null);
      } catch (caught) {
        const requestError = caught as RequestError;
        if (requestError.status === 401) {
          router.replace("/admin/sign-in");
          return;
        }
        setError(requestError.status === 403 ? "当前管理员没有修改此设置的权限。" : requestError.message || "设置更新失败，请重试。");
        setRetryMutation(() => run);
      }
    };
    await run();
  }

  function request<T>(url: string, init: RequestInit) {
    return fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }).then(readJson<T>);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8"><h1 className="text-3xl font-black">平台设置</h1><p className="mt-2 text-sm muted">设置分组由当前会话的精确职责能力决定，API 仍会再次授权。</p></header>
      {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error && hasRows ? <RetryAlert message={error} onRetry={() => retryMutation ? void retryMutation() : void load()} /> : null}
      {loading && !hasRows ? <AdminPageState title="正在加载平台设置…" /> : null}
      {error && !hasRows ? <AdminPageState title="无法加载平台设置" message={error} onRetry={() => retryMutation ? void retryMutation() : void load()} /> : null}
      {!loading && !error && !groups.length ? <AdminPageState title="当前角色没有可管理的设置" /> : null}

      <div className="space-y-8">
        {groups.includes("pricing") ? <SettingsSection title="定价" testId="settings-pricing" action={<button type="button" onClick={() => {
          const active = versions.find((item) => item.status === "active") ?? versions[0];
          void mutate(
            () => request<{ version: PricingVersion }>("/api/admin/pricing/versions", { method: "POST", body: JSON.stringify({ name: `价格草稿 ${new Date().toLocaleString("zh-CN")}`, copyFromVersionId: active?.id }) }),
            ({ version }) => setVersions((current) => [version, ...current]),
            "价格草稿已建立。"
          );
        }} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold">建立草稿</button>}>
          <AdminTable headers={["版本", "状态", "档位", "操作"]}>{versions.map((item) => <tr key={item.id}><td className="px-4 py-3 font-black">{item.name}<p className="text-xs font-normal muted">{item.id}</p></td><td className="px-4 py-3"><AdminStatus tone={item.status === "active" ? "success" : "neutral"}>{item.status}</AdminStatus></td><td className="px-4 py-3">{item.tiers?.length ?? 0}</td><td className="px-4 py-3">{item.status !== "active" ? <button type="button" onClick={() => void mutate(() => request<{ version: PricingVersion }>(`/api/admin/pricing/versions/${item.id}/publish`, { method: "POST" }), ({ version }) => setVersions((current) => current.map((row) => row.id === version.id ? version : row.status === "active" ? { ...row, status: "archived" } : row)), "价格版本已发布。") } className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">发布</button> : <span className="text-xs muted">生效中</span>}</td></tr>)}</AdminTable>
        </SettingsSection> : null}

        {groups.includes("platform-fee") ? <SettingsSection title="平台费" testId="settings-platform-fee" action={<button type="button" onClick={() => {
          const nextFee = fees.find((item) => item.status === "active")?.feeBps === 1500 ? 1000 : 1500;
          void mutate(() => request<{ config: FeeConfig }>("/api/admin/finance/fee-configs", { method: "POST", body: JSON.stringify({ name: `平台费 ${nextFee / 100}%`, feeBps: nextFee }) }), ({ config }) => setFees((current) => [config, ...current]), "平台费草稿已建立。");
        }} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold">建立平台费草稿</button>}>
          <AdminTable headers={["名称", "费率", "状态", "操作"]}>{fees.map((item) => <tr key={item.id}><td className="px-4 py-3 font-black">{item.name}</td><td className="px-4 py-3">{item.feeBps / 100}%</td><td className="px-4 py-3"><AdminStatus tone={item.status === "active" ? "success" : "neutral"}>{item.status}</AdminStatus></td><td className="px-4 py-3">{item.status !== "active" ? <button type="button" onClick={() => void mutate(() => request<{ config: FeeConfig }>(`/api/admin/finance/fee-configs/${item.id}/activate`, { method: "POST" }), ({ config }) => setFees((current) => current.map((row) => row.id === config.id ? config : row.status === "active" ? { ...row, status: "archived" } : row)), "平台费已启用。") } className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">启用</button> : <span className="text-xs muted">生效中</span>}</td></tr>)}</AdminTable>
        </SettingsSection> : null}

        {groups.includes("settlement-window") ? <SettingsSection title="结算窗口" testId="settings-settlement-window" action={<button type="button" onClick={() => {
          const holdDays = settlements.find((item) => item.status === "active")?.holdDays === 14 ? 7 : 14;
          void mutate(() => request<{ config: SettlementConfig }>("/api/admin/finance/settlement-configs", { method: "POST", body: JSON.stringify({ name: `结算 ${holdDays} 天`, holdDays }) }), ({ config }) => setSettlements((current) => [config, ...current]), "结算窗口草稿已建立。");
        }} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold">切换 7 / 14 天</button>}>
          <AdminTable headers={["名称", "冻结天数", "状态", "操作"]}>{settlements.map((item) => <tr key={item.id}><td className="px-4 py-3 font-black">{item.name}</td><td className="px-4 py-3">{item.holdDays} 天</td><td className="px-4 py-3"><AdminStatus tone={item.status === "active" ? "success" : "neutral"}>{item.status}</AdminStatus></td><td className="px-4 py-3">{item.status !== "active" ? <button type="button" onClick={() => void mutate(() => request<{ config: SettlementConfig }>(`/api/admin/finance/settlement-configs/${item.id}/activate`, { method: "POST" }), ({ config }) => setSettlements((current) => current.map((row) => row.id === config.id ? config : row.status === "active" ? { ...row, status: "archived" } : row)), "结算窗口已启用。") } className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">启用</button> : <span className="text-xs muted">生效中</span>}</td></tr>)}</AdminTable>
        </SettingsSection> : null}

        {groups.includes("payment-channels") ? <SettingsSection title="支付渠道" testId="settings-payment-channels">
          <AdminTable headers={["渠道", "模式", "状态", "操作"]}>{channels.map((item) => <tr key={item.provider}><td className="px-4 py-3 font-black">{item.provider}</td><td className="px-4 py-3">{item.mode}</td><td className="px-4 py-3"><AdminStatus tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "已启用" : "已停用"}</AdminStatus></td><td className="px-4 py-3"><button type="button" onClick={() => void mutate(() => request<{ channel: PaymentChannel }>(`/api/admin/payment-channels/${item.provider}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled, mode: item.mode, statusNote: "由平台设置更新" }) }), ({ channel }) => setChannels((current) => current.map((row) => row.provider === channel.provider ? channel : row)), "支付渠道已更新。") } className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">{item.enabled ? "停用" : "启用"}</button></td></tr>)}</AdminTable>
        </SettingsSection> : null}
      </div>
    </div>
  );
}

function SettingsSection({ title, testId, action, children }: { title: string; testId: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section data-testid={testId}><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">{title}</h2>{action}</div>{children}</section>;
}

function RetryAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700"><span>{message}</span><button type="button" onClick={onRetry} className="rounded-lg border border-rose-500 px-3 py-1 font-bold">重试</button></div>;
}
