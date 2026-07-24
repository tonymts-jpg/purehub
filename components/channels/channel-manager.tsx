"use client";

import {
  Archive,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  DatabaseZap,
  FileCheck2,
  ListFilter,
  LoaderCircle,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Shield,
  UserCog,
  UserPlus,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminRole } from "@/lib/platform-config";

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
type Membership = {
  id: string;
  role: "owner" | "editor" | "member";
  status: string;
  user: { name: string; handle: string };
};
type ChannelPost = {
  id: string;
  postId: string;
  status: string;
  source: string;
  position: number | null;
  pinnedAt: string | null;
  post?: { title: string };
};
type Rule = { id: string; kind: "category" | "tag" | "creator"; value: string; enabled: boolean };
type Exclusion = { id: string; postId: string; reason: string | null };
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
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
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const selected = useMemo(
    () => channels.find((channel) => channel.id === selectedId) ?? channels[0] ?? null,
    [channels, selectedId]
  );
  const isOwner = selected?.access.role === "owner";
  const canCurate = Boolean(selected?.access.canCurate);

  const loadChannels = useCallback(async () => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    try {
      const [dashboard, visible] = await Promise.all([
        api<{ channels: Channel[]; quota: Quota }>("/api/dashboard/channels?limit=50", undefined, controller.signal),
        api<{ channels: Channel[] }>("/api/channels?limit=50", undefined, controller.signal)
      ]);
      if (version !== requestVersion.current) return;
      const byId = new Map(dashboard.channels.map((channel) => [channel.id, channel]));
      for (const channel of visible.channels) {
        if (channel.id && channel.access?.canCurate && !byId.has(channel.id)) byId.set(channel.id, channel);
      }
      const next = [...byId.values()];
      setChannels(next);
      setQuota(dashboard.quota);
      setSelectedId((current) => next.some(({ id }) => id === current) ? current : next[0]?.id ?? null);
    } catch (caught) {
      const status = (caught as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        router.replace("/");
        return;
      }
      if (version === requestVersion.current) setError(errorMessage(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (!selected) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setDetailLoading(true);
    setError("");
    const prefix = `/api/dashboard/channels/${selected.id}`;
    const resources: Array<Promise<unknown>> = [
      api<{ channelPosts?: ChannelPost[]; posts?: ChannelPost[] }>(`${prefix}/posts?limit=50`, undefined, controller.signal),
      api<{ rules: Rule[] }>(`${prefix}/rules?limit=50`, undefined, controller.signal),
      api<{ exclusions: Exclusion[] }>(`${prefix}/exclusions?limit=50`, undefined, controller.signal)
    ];
    if (selected.access.role === "owner") {
      resources.push(api<{ memberships: Membership[] }>(`${prefix}/members?limit=50`, undefined, controller.signal));
    }
    Promise.all(resources)
      .then(([postBody, ruleBody, exclusionBody, memberBody]) => {
        if (version !== requestVersion.current) return;
        const postResult = postBody as { channelPosts?: ChannelPost[]; posts?: ChannelPost[] };
        setPosts(postResult.channelPosts ?? postResult.posts ?? []);
        setRules((ruleBody as { rules: Rule[] }).rules ?? []);
        setExclusions((exclusionBody as { exclusions: Exclusion[] }).exclusions ?? []);
        setMemberships((memberBody as { memberships?: Membership[] } | undefined)?.memberships ?? []);
      })
      .catch((caught) => {
        if (version === requestVersion.current) setError(errorMessage(caught));
      })
      .finally(() => {
        if (version === requestVersion.current) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  async function mutate(operation: () => Promise<unknown>, success: string, reload = true) {
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      if (reload) await loadChannels();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

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
              memberships={memberships}
              mutate={mutate}
            />
          )}

          {canCurate && (
            <CurationControls
              channel={selected}
              posts={posts}
              rules={rules}
              exclusions={exclusions}
              loading={detailLoading}
              mutate={mutate}
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
  mutate: (operation: () => Promise<unknown>, success: string, reload?: boolean) => Promise<void>;
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
          ).then(() => {
            setSlug("");
            setName("");
            setDescription("");
            setExpanded(false);
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
  memberships,
  mutate
}: {
  channel: Channel;
  memberships: Membership[];
  mutate: (operation: () => Promise<unknown>, success: string, reload?: boolean) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
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

      <div data-testid="channel-membership-manager" className="min-w-0">
        <h3 className="flex items-center gap-2 font-black"><UserCog size={17}/>成员与邀请</h3>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => api(`/api/dashboard/channels/${channel.id}/invitations`, {
                method: "POST",
                body: JSON.stringify({ email })
              }),
              "邀请已建立。",
              false
            ).then(() => setEmail(""));
          }}
        >
          <input aria-label="邀请邮箱" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm" placeholder="member@example.com"/>
          <IconButton label="发送频道邀请" type="submit"><UserPlus size={15}/>邀请</IconButton>
        </form>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead><tr className="border-b border-[var(--line)]"><th className="p-2">成员</th><th className="p-2">状态</th><th className="p-2">角色</th></tr></thead>
            <tbody>
              {memberships.map((membership) => (
                <tr key={membership.id} className="border-b border-[var(--line)]/60">
                  <td className="p-2 font-bold">{membership.user.name}<span className="ml-1 text-xs muted">@{membership.user.handle}</span></td>
                  <td className="p-2"><Status value={membership.status}/></td>
                  <td className="p-2">
                    <select
                      aria-label={`变更 ${membership.user.handle} 的角色`}
                      value={membership.role}
                      disabled={membership.role === "owner"}
                      onChange={(event) => void mutate(
                        () => api(`/api/dashboard/channels/${channel.id}/members/${membership.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ role: event.target.value })
                        }),
                        "成员角色已更新。"
                      )}
                      className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-xs"
                    >
                      <option value="owner">owner</option><option value="editor">editor</option><option value="member">member</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!memberships.length && <tr><td colSpan={3} className="p-3 text-sm muted">暂无成员资料。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CurationControls({
  channel,
  posts,
  rules,
  exclusions,
  loading,
  mutate
}: {
  channel: Channel;
  posts: ChannelPost[];
  rules: Rule[];
  exclusions: Exclusion[];
  loading: boolean;
  mutate: (operation: () => Promise<unknown>, success: string, reload?: boolean) => Promise<void>;
}) {
  const [postId, setPostId] = useState("");
  const [ruleKind, setRuleKind] = useState<Rule["kind"]>("category");
  const [ruleValue, setRuleValue] = useState("");
  const [excludedPostId, setExcludedPostId] = useState("");
  const [reason, setReason] = useState("");
  const prefix = `/api/dashboard/channels/${channel.id}`;

  return (
    <section data-testid="channel-curation-manager" className="border-t border-[var(--line)] pt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-black"><ListFilter size={18}/>策展管理</h3>
        {loading && <LoaderCircle aria-label="正在更新策展资料" className="animate-spin muted" size={17}/>}
      </div>
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0">
          <h4 className="font-bold">作品、顺序与置顶</h4>
          <form className="mt-2 flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => api(`${prefix}/posts`, { method: "POST", body: JSON.stringify({ postId }) }),
              "作品已加入频道。"
            ).then(() => setPostId(""));
          }}>
            <input aria-label="作品 ID" required value={postId} onChange={(event) => setPostId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            <IconButton label="加入作品" type="submit"><Plus size={15}/></IconButton>
          </form>
          <ul className="mt-3 space-y-2">
            {posts.map((post, index) => (
              <li key={post.id} className="flex min-w-0 items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{post.post?.title ?? post.postId}<span className="ml-1 text-xs muted">{post.source}</span></span>
                <IconButton label={`置顶 ${post.post?.title ?? post.postId}`} onClick={() => void mutate(
                  () => api(`${prefix}/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ pinned: !post.pinnedAt }) }),
                  "置顶状态已更新。"
                )}><Pin size={14}/></IconButton>
                <IconButton label={`下移 ${post.post?.title ?? post.postId}`} disabled={index === posts.length - 1} onClick={() => void mutate(
                  () => api(`${prefix}/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ position: index + 1 }) }),
                  "顺序已更新。"
                )}><ChevronDown size={14}/></IconButton>
                <IconButton label={`移除 ${post.post?.title ?? post.postId}`} onClick={() => {
                  if (window.confirm("确认从频道移除这个作品？")) {
                    void mutate(() => api(`${prefix}/posts/${post.id}`, { method: "DELETE", body: "{}" }), "作品已移除。");
                  }
                }}><X size={14}/></IconButton>
              </li>
            ))}
            {!posts.length && <li className="text-sm muted">尚无策展作品。</li>}
          </ul>
        </div>

        <div>
          <h4 className="font-bold">自动规则</h4>
          <form className="mt-2 grid grid-cols-[120px_1fr_auto] gap-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => api(`${prefix}/rules`, { method: "POST", body: JSON.stringify({ kind: ruleKind, value: ruleValue, enabled: true }) }),
              "规则已建立。"
            ).then(() => setRuleValue(""));
          }}>
            <select aria-label="规则类型" value={ruleKind} onChange={(event) => setRuleKind(event.target.value as Rule["kind"])} className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-2 text-sm">
              <option value="category">分类</option><option value="tag">标签</option><option value="creator">Creator</option>
            </select>
            <input aria-label="规则值" required value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="min-w-0 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            <IconButton label="新增规则" type="submit"><Plus size={15}/></IconButton>
          </form>
          <ul className="mt-3 space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                <span className="flex-1"><b>{rule.kind}</b> · {rule.value}</span>
                <Status value={rule.enabled ? "enabled" : "disabled"}/>
                <IconButton label={`删除规则 ${rule.value}`} onClick={() => {
                  if (window.confirm("确认删除这项自动规则？")) {
                    void mutate(() => api(`${prefix}/rules/${rule.id}`, { method: "DELETE", body: "{}" }), "规则已删除。");
                  }
                }}><X size={14}/></IconButton>
              </li>
            ))}
            {!rules.length && <li className="text-sm muted">尚无自动规则。</li>}
          </ul>
        </div>

        <div>
          <h4 className="font-bold">手动排除</h4>
          <form className="mt-2 space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => api(`${prefix}/exclusions`, { method: "POST", body: JSON.stringify({ postId: excludedPostId, reason }) }),
              "作品已排除。"
            ).then(() => {
              setExcludedPostId("");
              setReason("");
            });
          }}>
            <div className="flex gap-2">
              <input aria-label="排除作品 ID" required value={excludedPostId} onChange={(event) => setExcludedPostId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
              <IconButton label="新增排除" type="submit"><Archive size={15}/></IconButton>
            </div>
            <input aria-label="排除原因" required value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm" placeholder="说明排除原因"/>
          </form>
          <ul className="mt-3 space-y-2">
            {exclusions.map((exclusion) => (
              <li key={exclusion.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{exclusion.postId}<span className="ml-1 text-xs muted">{exclusion.reason}</span></span>
                <IconButton label={`取消排除 ${exclusion.postId}`} onClick={() => {
                  if (window.confirm("确认取消这项手动排除？")) {
                    void mutate(() => api(`${prefix}/exclusions/${exclusion.id}`, { method: "DELETE", body: "{}" }), "排除已取消。");
                  }
                }}><X size={14}/></IconButton>
              </li>
            ))}
            {!exclusions.length && <li className="text-sm muted">尚无手动排除。</li>}
          </ul>
        </div>
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
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    if (!allowed) {
      setChannels([]);
      return;
    }
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filter !== "all") params.set("status", filter);
      const body = await api<{ channels: Channel[] }>(`/api/admin/channels?${params}`, undefined, controller.signal);
      if (version === requestVersion.current) setChannels(body.channels);
    } catch (caught) {
      if (version === requestVersion.current) setError(errorMessage(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
    return () => controller.abort();
  }, [allowed, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(operation: () => Promise<unknown>, success: string) {
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

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
              <thead><tr className="border-b border-[var(--line)]"><th className="p-2">频道</th><th className="p-2">所有者</th><th className="p-2">状态</th><th className="p-2">审核</th><th className="p-2">生命周期</th><th className="p-2">作业</th></tr></thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={channel.id} className="border-b border-[var(--line)]/70">
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
                {!loading && !channels.length && <tr><td colSpan={6} className="p-6 text-center text-sm muted">这个筛选条件下没有频道。</td></tr>}
              </tbody>
            </table>
            {loading && <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm muted"><LoaderCircle className="animate-spin" size={17}/>正在载入频道…</p>}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <form className="border-t border-[var(--line)] pt-4" onSubmit={(event) => {
              event.preventDefault();
              const target = channels[0];
              if (!target) return;
              if (window.confirm(`确认覆盖 ${target.ownerUserId} 的频道配额？`)) {
                void mutate(
                  () => api(`/api/admin/channels/quotas/${target.ownerUserId}`, { method: "PUT", body: JSON.stringify({ maxChannels: Number(quota), reason: quotaReason }) }),
                  "Creator 频道配额已更新。"
                );
              }
            }}>
              <h3 className="font-black">Creator 配额</h3>
              <div className="mt-2 grid grid-cols-[120px_1fr_auto] gap-2">
                <input aria-label="频道配额" type="number" min="0" max="100" required value={quota} onChange={(event) => setQuota(event.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <input aria-label="配额原因" required value={quotaReason} onChange={(event) => setQuotaReason(event.target.value)} className="min-w-0 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <IconButton label="保存频道配额" type="submit" disabled={!channels.length}><UserCog size={15}/></IconButton>
              </div>
              <p className="mt-1 text-xs muted">套用至目前筛选结果中的第一位频道所有者。</p>
            </form>

            <form className="border-t border-[var(--line)] pt-4" onSubmit={(event) => {
              event.preventDefault();
              const target = channels[0];
              if (!target) return;
              if (window.confirm(`确认由 ${takeoverUserId} 接管「${target.name}」？`)) {
                void mutate(
                  () => api(`/api/admin/channels/${target.id}/takeover`, { method: "POST", body: JSON.stringify({ newOwnerUserId: takeoverUserId }) }),
                  "频道所有权已接管。"
                ).then(() => setTakeoverUserId(""));
              }
            }}>
              <h3 className="font-black">所有权接管</h3>
              <div className="mt-2 flex gap-2">
                <input aria-label="接管新所有者 ID" required value={takeoverUserId} onChange={(event) => setTakeoverUserId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
                <IconButton label="接管频道" type="submit" disabled={!channels.length}><UserPlus size={15}/></IconButton>
              </div>
              <p className="mt-1 text-xs muted">接管将原子化更新唯一 active owner，并留下审计记录。</p>
            </form>
          </div>
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
            ).then(() => setReviewChannel(null));
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
