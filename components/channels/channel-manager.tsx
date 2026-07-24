"use client";

import {
  Archive,
  Check,
  CircleAlert,
  Clock3,
  DatabaseZap,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  UserCog,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminRole } from "@/lib/platform-config";
import { ChannelCurationManager } from "./channel-curation-manager";
import { channelErrorMessage, loadEveryChannelPage } from "./channel-management-api";
import {
  adminChannelOperations,
  executeChannelOperation,
  officialChannelOperationsAvailable
} from "./channel-management-operations";
import type { ManagedChannel, MutationRunner } from "./channel-management-types";
import { ChannelMembershipManager } from "./channel-membership-manager";

type Access = {
  canRead: boolean;
  canManage: boolean;
  canCurate: boolean;
  canManageMembers: boolean;
  role: "owner" | "editor" | "member" | null;
};

type Channel = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "official" | "creator";
  visibility: "public" | "private";
  discoverability: "discoverable" | "hidden";
  status: "draft" | "pending" | "active" | "rejected" | "suspended" | "archived";
  ownerUserId: string;
  memberPostPolicy: "direct" | "approval_required";
  reviewNote: string | null;
  updatedAt: string;
  access: Access;
};

type Quota = { used: number; limit: number; levelId: string; overridden: boolean };
type AdminContext = { role: AdminRole; permissions: string[] } | null;

async function api<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body as T;
}

function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-black/5 px-2 py-1 text-xs font-bold dark:bg-white/10">
      {value}
    </span>
  );
}

function IconButton({
  label,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--line)] px-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ChannelManager() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);

  const selected = useMemo(
    () => channels.find((channel) => channel.id === selectedId) ?? channels[0] ?? null,
    [channels, selectedId]
  );
  const isOwner = selected?.access.role === "owner";
  const canCurate = Boolean(selected?.access.canCurate);

  const loadChannels = useCallback(async () => {
    const version = ++requestVersion.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const [dashboard, visible] = await Promise.all([
        loadEveryChannelPage<Channel>("/api/dashboard/channels", "channels", controller.signal),
        loadEveryChannelPage<Channel>("/api/channels", "channels", controller.signal)
      ]);
      if (version !== requestVersion.current) return;
      const byId = new Map(dashboard.items.map((channel) => [channel.id, channel]));
      for (const channel of visible.items) {
        if (channel.id && channel.access?.canCurate && !byId.has(channel.id)) byId.set(channel.id, channel);
      }
      const next = [...byId.values()];
      setChannels(next);
      setQuota((dashboard.firstBody.quota as Quota | undefined) ?? null);
      setSelectedId((current) => next.some(({ id }) => id === current) ? current : next[0]?.id ?? null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const status = (caught as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        router.replace("/");
        return;
      }
      if (version === requestVersion.current) setError(channelErrorMessage(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadChannels();
    return () => loadController.current?.abort();
  }, [loadChannels]);

  const mutate: MutationRunner = async (operation, success, options) => {
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      if (options?.refresh !== false) await loadChannels();
      return true;
    } catch (caught) {
      setError(channelErrorMessage(caught));
      return false;
    }
  };

  if (loading) {
    return <p role="status" className="flex items-center gap-2 py-10 text-sm muted"><LoaderCircle className="animate-spin" size={18}/>正在加载频道管理资料…</p>;
  }
  if (error && !channels.length) {
    return (
      <div role="alert" className="rounded-lg border border-rose-500/40 p-5">
        <p>{error}</p>
        <button type="button" onClick={() => void loadChannels()} className="mt-3 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-bold">重试</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 border-y border-[var(--line)] py-5 sm:grid-cols-[220px_1fr]">
        <div data-testid="channel-quota">
          <p className="text-xs font-bold uppercase tracking-wide muted">Creator quota</p>
          <p className="mt-1 text-2xl font-black">{quota ? `${quota.used} / ${quota.limit}` : "—"}</p>
          <p className="text-xs muted">{quota?.levelId ?? "尚无等级"}{quota?.overridden ? " · 管理员覆盖" : ""}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide muted">可管理频道</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {channels.map((channel) => (
              <button
                type="button"
                key={channel.id}
                onClick={() => setSelectedId(channel.id)}
                className={`rounded-full border px-3 py-2 text-sm font-bold ${selected?.id === channel.id ? "border-violet bg-violet/10 text-violet" : "border-[var(--line)]"}`}
              >
                {channel.name}
              </button>
            ))}
            {!channels.length && <p className="text-sm muted">尚未建立或受邀管理频道。</p>}
          </div>
        </div>
      </section>

      {message && <p role="status" className="rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="rounded-md bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}

      <CreateChannelForm mutate={mutate}/>

      {selected && (
        <>
          <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black">{selected.name}</h2>
                <Status value={selected.status}/>
                <span data-testid="channel-current-role" className="text-xs font-bold muted">{selected.access.role ?? "viewer"}</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm muted">{selected.description}</p>
              <p data-testid="channel-review-status" className="mt-2 text-xs muted">
                审核状态：{selected.status}{selected.reviewNote ? ` · ${selected.reviewNote}` : ""}
              </p>
            </div>
            <IconButton label="刷新频道资料" onClick={() => void loadChannels()}><RefreshCw size={15}/>刷新</IconButton>
          </section>

          {isOwner && (
            <OwnerControls
              channel={selected}
              mutate={mutate}
            />
          )}

          {selected.access.canManageMembers && (
            <ChannelMembershipManager
              key={selected.id}
              channel={selected as ManagedChannel}
              canManage={selected.access.role === "owner"}
              runMutation={mutate}
            />
          )}

          {canCurate && (
            <ChannelCurationManager
              key={selected.id}
              channel={selected as ManagedChannel}
              runMutation={mutate}
            />
          )}
        </>
      )}
    </div>
  );
}

function CreateChannelForm({
  mutate
}: {
  mutate: MutationRunner;
}) {
  const [expanded, setExpanded] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [discoverability, setDiscoverability] = useState<"discoverable" | "hidden">("discoverable");

  return (
    <section data-testid="channel-create-form" className="border-t border-[var(--line)] pt-5">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-bold">
        <Plus size={16}/>{expanded ? "收起建立表单" : "建立 Creator 频道"}
      </button>
      {expanded && (
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          void mutate(
            () => api("/api/dashboard/channels", {
              method: "POST",
              body: JSON.stringify({
                slug,
                name,
                description,
                visibility,
                discoverability: visibility === "public" ? "discoverable" : discoverability,
                memberPostPolicy: "approval_required"
              })
            }),
            "Creator 频道草稿已建立。"
          ).then((ok) => {
            if (ok) {
              setSlug("");
              setName("");
              setDescription("");
              setExpanded(false);
            }
          });
        }}>
          <label className="text-sm font-bold">名称
            <input required minLength={3} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-normal"/>
          </label>
          <label className="text-sm font-bold">Slug
            <input required pattern="[a-z0-9-]{3,50}" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50))} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-normal"/>
          </label>
          <label className="text-sm font-bold md:col-span-2">说明
            <textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-normal"/>
          </label>
          <label className="text-sm font-bold">可见性
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-normal">
              <option value="public">public</option><option value="private">private</option>
            </select>
          </label>
          <label className="text-sm font-bold">私人频道发现方式
            <select disabled={visibility === "public"} value={discoverability} onChange={(event) => setDiscoverability(event.target.value as typeof discoverability)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-normal disabled:opacity-50">
              <option value="discoverable">discoverable</option><option value="hidden">hidden</option>
            </select>
          </label>
          <button type="submit" className="rounded-md bg-violet px-4 py-2 text-sm font-bold text-white md:col-span-2">建立草稿</button>
        </form>
      )}
    </section>
  );
}

function OwnerControls({
  channel,
  mutate
}: {
  channel: Channel;
  mutate: MutationRunner;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [visibility, setVisibility] = useState(channel.visibility);
  const [discoverability, setDiscoverability] = useState(channel.discoverability);
  const [policy, setPolicy] = useState(channel.memberPostPolicy);

  useEffect(() => {
    setName(channel.name);
    setDescription(channel.description);
    setVisibility(channel.visibility);
    setDiscoverability(channel.discoverability);
    setPolicy(channel.memberPostPolicy);
  }, [channel]);

  return (
    <section data-testid="channel-owner-controls" className="grid gap-6 border-t border-[var(--line)] pt-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 font-black"><Shield size={17}/>所有者设置</h3>
        <form data-testid="channel-settings-form" className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          void mutate(
            () => api(`/api/dashboard/channels/${channel.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                name,
                description,
                visibility,
                discoverability: visibility === "public" ? "discoverable" : discoverability,
                memberPostPolicy: policy
              })
            }),
            "频道设置已更新。"
          );
        }}>
          <label className="text-sm font-bold">频道名称
            <input required minLength={3} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-normal"/>
          </label>
          <label className="text-sm font-bold">频道说明
            <textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-normal"/>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">可见性
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-normal">
                <option value="public">public</option><option value="private">private</option>
              </select>
            </label>
            <label className="text-sm font-bold">发现方式
              <select disabled={visibility === "public"} value={discoverability} onChange={(event) => setDiscoverability(event.target.value as typeof discoverability)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-normal disabled:opacity-50">
                <option value="discoverable">discoverable</option><option value="hidden">hidden</option>
              </select>
            </label>
          </div>
          <div data-testid="channel-policy-control">
            <label htmlFor="channel-policy" className="text-sm font-bold">成员投稿政策</label>
            <select id="channel-policy" value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
              <option value="direct">直接发布</option>
              <option value="approval_required">需要审核</option>
            </select>
          </div>
          <button type="submit" className="rounded-md bg-[var(--text)] px-3 py-2 text-sm font-bold text-[var(--bg)]">保存频道设置</button>
        </form>
        {(channel.status === "draft" || channel.status === "rejected") && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("提交后将等待管理员审核，确认继续？")) {
                void mutate(
                  () => api(`/api/dashboard/channels/${channel.id}/submit`, { method: "POST", body: "{}" }),
                  "频道已提交审核。"
                );
              }
            }}
            className="inline-flex items-center gap-2 rounded-md bg-violet px-3 py-2 text-sm font-bold text-white"
          >
            <FileCheck2 size={16}/>提交审核
          </button>
        )}
      </div>

    </section>
  );
}

const channelAdminRoles = new Set<AdminRole>(["super_admin", "ops_admin", "content_admin"]);

export function AdminChannelOperations({ admin }: { admin: AdminContext }) {
  const allowed = Boolean(admin && admin.permissions.includes("channels") && channelAdminRoles.has(admin.role));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewChannel, setReviewChannel] = useState<Channel | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [quota, setQuota] = useState("3");
  const [quotaReason, setQuotaReason] = useState("Admin dashboard override");
  const [takeoverUserId, setTakeoverUserId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [officialSlug, setOfficialSlug] = useState("");
  const [officialName, setOfficialName] = useState("");
  const [officialDescription, setOfficialDescription] = useState("");
  const requestVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const selected = channels.find((channel) => channel.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!allowed) {
      setChannels([]);
      return;
    }
    const version = ++requestVersion.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      const result = await loadEveryChannelPage<Channel>(
        `/api/admin/channels${params.size ? `?${params}` : ""}`,
        "channels",
        controller.signal
      );
      if (version === requestVersion.current) {
        setChannels(result.items);
        setSelectedId((current) => result.items.some(({ id }) => id === current) ? current : null);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (version === requestVersion.current) setError(channelErrorMessage(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [allowed, filter]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const mutate: MutationRunner = async (operation, success, options) => {
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      if (options?.refresh !== false) await load();
      return true;
    } catch (caught) {
      setError(channelErrorMessage(caught));
      return false;
    }
  };

  return (
    <section data-testid="admin-channel-operations" className="mt-8 border-y border-[var(--line)] py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black"><DatabaseZap size={20}/>频道运营</h2>
          <p className="mt-1 text-sm muted">审核、生命周期、所有权、配额与索引作业。</p>
        </div>
        {allowed ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold muted">
              频道状态筛选
              <select aria-label="频道状态筛选" value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 block rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
                <option value="all">全部</option><option value="pending">待审核</option><option value="active">active</option><option value="draft">draft</option><option value="rejected">rejected</option><option value="suspended">suspended</option><option value="archived">archived</option>
              </select>
            </label>
            <IconButton label="重新载入频道" onClick={() => void load()}><RefreshCw size={15}/></IconButton>
            <IconButton label="重新索引搜索" onClick={() => {
              if (window.confirm("确认安排全站 PostgreSQL 搜索重新索引？")) {
                void mutate(() => api("/api/admin/search/reindex", { method: "POST", body: "{}" }), "重新索引作业已排程。");
              }
            }}><Search size={15}/>重新索引搜索</IconButton>
          </div>
        ) : (
          <p className="rounded-md bg-black/5 px-3 py-2 text-sm font-bold dark:bg-white/10">当前管理员角色无频道变更权限</p>
        )}
      </div>

      {message && <p role="status" className="mt-4 rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-4 flex items-center gap-2 rounded-md bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"><CircleAlert size={16}/>{error}</p>}

      {allowed && (
        <>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead><tr className="border-b border-[var(--line)]"><th className="p-2">选择</th><th className="p-2">频道</th><th className="p-2">所有者</th><th className="p-2">状态</th><th className="p-2">审核</th><th className="p-2">生命周期</th><th className="p-2">作业</th></tr></thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={channel.id} className="border-b border-[var(--line)]/70">
                    <td className="p-2">
                      <input
                        type="radio"
                        name="admin-channel-selection"
                        aria-label={`选择频道 ${channel.name}`}
                        checked={selectedId === channel.id}
                        onChange={() => setSelectedId(channel.id)}
                      />
                    </td>
                    <td className="p-2 font-bold">{channel.name}<p className="text-xs font-normal muted">{channel.kind} · {channel.visibility}</p></td>
                    <td className="p-2 text-xs">{channel.ownerUserId}</td>
                    <td className="p-2"><Status value={channel.status}/></td>
                    <td className="p-2">
                      <IconButton label="审核频道" disabled={channel.status !== "pending"} onClick={() => {
                        setReviewChannel(channel);
                        setReviewNote("");
                      }}><FileCheck2 size={14}/></IconButton>
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <IconButton label={`暂停 ${channel.name}`} disabled={channel.status !== "active"} onClick={() => {
                          if (window.confirm(`确认暂停「${channel.name}」？`)) void mutate(() => api(`/api/admin/channels/${channel.id}/suspend`, { method: "POST", body: "{}" }), "频道已暂停。");
                        }}><Clock3 size={14}/></IconButton>
                        <IconButton label={`恢复 ${channel.name}`} disabled={channel.status !== "suspended"} onClick={() => {
                          if (window.confirm(`确认恢复「${channel.name}」？`)) void mutate(() => api(`/api/admin/channels/${channel.id}/restore`, { method: "POST", body: "{}" }), "频道已恢复。");
                        }}><Check size={14}/></IconButton>
                        <IconButton label={`封存 ${channel.name}`} disabled={channel.status === "archived"} onClick={() => {
                          if (window.confirm(`确认封存「${channel.name}」？`)) {
                            void mutate(
                              () => executeChannelOperation(adminChannelOperations.archive(channel.id)),
                              "频道已封存。"
                            );
                          }
                        }}><Archive size={14}/></IconButton>
                      </div>
                    </td>
                    <td className="p-2">
                      <IconButton label="重新物化频道" onClick={() => {
                        if (window.confirm(`确认重新物化「${channel.name}」的策展规则？`)) {
                          void mutate(
                            () => api(`/api/admin/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ description: channel.description }) }),
                            "频道物化作业已排程。"
                          );
                        }
                      }}><RefreshCw size={14}/>重新物化频道</IconButton>
                    </td>
                  </tr>
                ))}
                {!loading && !channels.length && <tr><td colSpan={7} className="p-6 text-center text-sm muted">这个筛选条件下没有频道。</td></tr>}
              </tbody>
            </table>
            {loading && <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm muted"><LoaderCircle className="animate-spin" size={17}/>正在载入频道…</p>}
          </div>

          <form className="mt-5 border-t border-[var(--line)] pt-4" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => executeChannelOperation(adminChannelOperations.official({
                slug: officialSlug,
                name: officialName,
                description: officialDescription
              })),
              "官方频道已建立。"
            ).then((ok) => {
              if (ok) {
                setOfficialSlug("");
                setOfficialName("");
                setOfficialDescription("");
              }
            });
          }}>
            <h3 className="font-black">建立官方频道</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <input aria-label="官方频道名称" required minLength={3} value={officialName} onChange={(event) => setOfficialName(event.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
              <input aria-label="官方频道 Slug" required pattern="[a-z0-9-]{3,50}" value={officialSlug} onChange={(event) => setOfficialSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50))} className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
              <input aria-label="官方频道说明" value={officialDescription} onChange={(event) => setOfficialDescription(event.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            </div>
            <button type="submit" className="mt-2 rounded-md bg-violet px-3 py-2 text-sm font-bold text-white">建立官方频道</button>
          </form>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <form className="border-t border-[var(--line)] pt-4" onSubmit={(event) => {
              event.preventDefault();
              const target = selected;
              if (!target) return;
              if (window.confirm(`确认覆盖 ${target.ownerUserId} 的频道配额？`)) {
                void mutate(
                  () => executeChannelOperation(adminChannelOperations.quota(
                    target.ownerUserId,
                    Number(quota),
                    quotaReason
                  )),
                  "Creator 频道配额已更新。"
                );
              }
            }}>
              <h3 className="font-black">Creator 配额</h3>
              <div className="mt-2 grid grid-cols-[120px_1fr_auto] gap-2">
                <input aria-label="频道配额" type="number" min="0" max="100" required value={quota} onChange={(event) => setQuota(event.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <input aria-label="配额原因" required value={quotaReason} onChange={(event) => setQuotaReason(event.target.value)} className="min-w-0 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <IconButton label="保存频道配额" type="submit" disabled={!selected}><UserCog size={15}/></IconButton>
              </div>
              <p className="mt-1 text-xs muted">{selected ? `套用至已选择频道的所有者 ${selected.ownerUserId}。` : "请先明确选择一个频道。"}</p>
            </form>

            <form className="border-t border-[var(--line)] pt-4" onSubmit={(event) => {
              event.preventDefault();
              const target = selected;
              if (!target) return;
              if (window.confirm(`确认由 ${takeoverUserId} 接管「${target.name}」？`)) {
                void mutate(
                  () => executeChannelOperation(adminChannelOperations.takeover(target.id, takeoverUserId)),
                  "频道所有权已接管。"
                ).then((ok) => {
                  if (ok) setTakeoverUserId("");
                });
              }
            }}>
              <h3 className="font-black">所有权接管</h3>
              <div className="mt-2 flex gap-2">
                <input aria-label="接管新所有者 ID" required value={takeoverUserId} onChange={(event) => setTakeoverUserId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <IconButton label="接管频道" type="submit" disabled={!selected}><UserPlus size={15}/></IconButton>
              </div>
              <p className="mt-1 text-xs muted">接管将原子化更新唯一 active owner，并留下审计记录。</p>
            </form>
          </div>

          {selected && officialChannelOperationsAvailable(selected.kind, selected.status) && (
            <div className="mt-6 space-y-6 border-t border-[var(--line)] pt-5">
              <h3 className="font-black">已选择官方频道的成员与策展</h3>
              <ChannelMembershipManager
                key={`admin-members-${selected.id}`}
                channel={selected as ManagedChannel}
                canManage={allowed}
                runMutation={mutate}
              />
              <ChannelCurationManager
                key={`admin-curation-${selected.id}`}
                channel={selected as ManagedChannel}
                runMutation={mutate}
              />
            </div>
          )}
          {selected?.kind === "official" && selected.status !== "active" && (
            <p role="status" className="mt-6 rounded-md bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-200">
              此官方频道目前为 {selected.status}；只有 active 频道可管理成员与策展。
            </p>
          )}
        </>
      )}

      {reviewChannel && (
        <div role="dialog" aria-modal="true" aria-label="审核频道" className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <form className="w-full max-w-md rounded-lg bg-[var(--card)] p-5 shadow-2xl" onSubmit={(event) => {
            event.preventDefault();
            const target = reviewChannel;
            void mutate(
              () => api(`/api/admin/channels/${target.id}/review`, { method: "POST", body: JSON.stringify({ decision: reviewDecision, note: reviewNote }) }),
              reviewDecision === "approved" ? "频道已通过审核。" : "频道已拒绝。"
            ).then((ok) => {
              if (ok) setReviewChannel(null);
            });
          }}>
            <h3 className="text-lg font-black">审核频道</h3>
            <p className="mt-1 text-sm muted">{reviewChannel.name}</p>
            <label className="mt-4 block text-sm font-bold">决定
              <select value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as typeof reviewDecision)} className="mt-1 block w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2">
                <option value="approved">通过</option><option value="rejected">拒绝</option>
              </select>
            </label>
            <label className="mt-3 block text-sm font-bold">审核备注
              <textarea required value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"/>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReviewChannel(null)} className="rounded-md border border-[var(--line)] px-3 py-2 text-sm font-bold">取消审核</button>
              <button type="submit" className="rounded-md bg-violet px-3 py-2 text-sm font-bold text-white">确认审核</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
