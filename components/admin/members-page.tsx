"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Member = {
  id: string;
  name: string;
  handle: string;
  status: string;
  role: string;
  creatorStatus: string;
  isAdministrator: boolean;
  manageable: boolean;
  creatorProfile?: { followers: number; members: number; levelId: string | null } | null;
};

function filteredParams(source: URLSearchParams, keys: readonly string[]) {
  const target = new URLSearchParams();
  for (const key of keys) {
    const value = source.get(key)?.trim();
    if (value) target.set(key, value);
  }
  return target;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  return body as T;
}

export async function loadAdminMembers(params: URLSearchParams, fetcher: Fetcher = fetch) {
  const query = filteredParams(params, ["q", "role", "status"]);
  return readJson<{ users: Member[] }>(
    await fetcher(`/api/admin/users${query.size ? `?${query}` : ""}`)
  );
}

export async function updateAdminMemberStatus(
  id: string,
  status: "active" | "suspended",
  fetcher: Fetcher = fetch
) {
  const body = await readJson<{ user: Pick<Member, "id" | "status"> }>(
    await fetcher(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    })
  );
  return body.user;
}

export function memberStatusControlAllowed(
  canWrite: boolean,
  user: Pick<Member, "isAdministrator" | "manageable"> & { role?: string }
) {
  return canWrite && user.manageable && !user.isAdministrator;
}

export function MembersPage({
  initialQ = "",
  initialRole = "",
  initialStatus = "",
  canWrite
}: {
  initialQ?: string;
  initialRole?: string;
  initialStatus?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus);
  const [users, setUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (role) next.set("role", role);
    if (status) next.set("status", status);
    return next;
  }, [q, role, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminMembers(params);
      const normalizedQ = q.trim().toLocaleLowerCase();
      setUsers(body.users.filter((user) =>
        (!normalizedQ || `${user.name} ${user.handle}`.toLocaleLowerCase().includes(normalizedQ))
        && (!role || user.role === role)
        && (!status || user.status === status)
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [params, q, role, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters() {
    router.replace(`/admin/members${params.size ? `?${params}` : ""}`);
  }

  async function updateStatus(user: Member) {
    setError("");
    setMessage("");
    const nextStatus = user.status === "active" ? "suspended" : "active";
    try {
      const updated = await updateAdminMemberStatus(user.id, nextStatus);
      setUsers((current) => current.map((item) =>
        item.id === user.id ? { ...item, status: updated.status } : item
      ));
      setMessage(nextStatus === "suspended" ? "账号已暂停。" : "账号已恢复。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号状态更新失败，请重试。");
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <DomainHeader title="会员管理" subtitle={canWrite ? "搜索会员并检查账号、角色与创作者状态。" : "当前角色仅可查看会员资料。"} />
      <form className="mb-6 grid gap-3 rounded-2xl border border-[var(--line)] p-4 md:grid-cols-[1fr_180px_180px_auto]" onSubmit={(event) => {
        event.preventDefault();
        applyFilters();
        void load();
      }}>
        <input aria-label="搜索会员" value={q} onChange={(event) => setQ(event.target.value)} placeholder="姓名或账号" className="rounded-xl border border-[var(--line)] bg-transparent px-3 py-2" />
        <select aria-label="会员角色筛选" value={role} onChange={(event) => setRole(event.target.value)} className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2">
          <option value="">全部角色</option><option value="fan">fan</option><option value="creator">creator</option><option value="admin">admin</option>
        </select>
        <select aria-label="账号状态筛选" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2">
          <option value="">全部状态</option><option value="active">active</option><option value="suspended">suspended</option>
        </select>
        <button type="submit" className="rounded-xl bg-[var(--text)] px-4 py-2 font-bold text-[var(--bg)]">筛选</button>
      </form>

      {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error && users.length ? <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading && !users.length ? <AdminPageState title="正在加载会员…" /> : null}
      {error && !users.length ? <AdminPageState title="无法加载会员" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !users.length ? <AdminPageState title="没有符合条件的会员" message="请调整搜索或筛选条件。" /> : null}
      {users.length ? (
        <AdminTable headers={["会员", "账号状态", "角色", "创作者状态", "等级 / 粉丝", "操作"]}>
          {users.map((user) => (
            <tr key={user.id}>
              <td className="px-4 py-3 font-black">{user.name}<p className="text-xs font-normal muted">@{user.handle}</p></td>
              <td className="px-4 py-3"><AdminStatus tone={user.status === "active" ? "success" : "danger"}>{user.status}</AdminStatus></td>
              <td className="px-4 py-3">{user.role}</td>
              <td className="px-4 py-3">{user.creatorStatus}</td>
              <td className="px-4 py-3">{user.creatorProfile?.levelId ?? "—"}<p className="text-xs muted">{user.creatorProfile?.followers ?? 0} 粉丝</p></td>
              <td className="px-4 py-3">
                {memberStatusControlAllowed(canWrite, user) ? (
                  <button
                    type="button"
                    onClick={() => void updateStatus(user)}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold"
                  >
                    {user.status === "active" ? "暂停账号" : "恢复账号"} {user.name}
                  </button>
                ) : <span className="text-xs muted">{user.isAdministrator ? "管理员账号" : "只读"}</span>}
              </td>
            </tr>
          ))}
        </AdminTable>
      ) : null}
    </div>
  );
}

function DomainHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="mb-8"><h1 className="text-3xl font-black">{title}</h1><p className="mt-2 text-sm muted">{subtitle}</p></header>;
}
