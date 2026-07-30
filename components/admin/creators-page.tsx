"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Application = {
  id: string;
  displayName: string;
  category: string;
  contact: string;
  status: string;
  user: { handle: string };
};
type Level = {
  id: string;
  name: string;
  minFollowers: number;
  maxFollowers: number | null;
  _count?: { creators: number };
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  return body as T;
}

export async function loadAdminCreators(params: URLSearchParams, fetcher: Fetcher = fetch) {
  const query = new URLSearchParams();
  for (const key of ["status", "q"]) {
    const value = params.get(key)?.trim();
    if (value) query.set(key, value);
  }
  const [applications, levels] = await Promise.all([
    readJson<{ applications: Application[] }>(
      await fetcher(`/api/admin/creator-applications${query.size ? `?${query}` : ""}`)
    ),
    readJson<{ levels: Level[] }>(await fetcher("/api/admin/creator-levels"))
  ]);
  return { applications: applications.applications, levels: levels.levels };
}

export function CreatorsPage({
  initialStatus = "",
  initialQ = "",
  canWrite
}: {
  initialStatus?: string;
  initialQ?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState(initialQ);
  const [applications, setApplications] = useState<Application[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (q) next.set("q", q);
    return next;
  }, [q, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminCreators(params);
      const normalizedQ = q.trim().toLocaleLowerCase();
      setApplications(body.applications.filter((application) =>
        (!status || application.status === status)
        && (!normalizedQ || `${application.displayName} ${application.user.handle} ${application.category}`.toLocaleLowerCase().includes(normalizedQ))
      ));
      setLevels(body.levels);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [params, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: "approved" | "rejected") {
    setError("");
    const response = await fetch(`/api/admin/creator-applications/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: decision })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "审核失败，请重试。");
      return;
    }
    setMessage(decision === "approved" ? "创作者申请已通过。" : "创作者申请已拒绝。");
    await load();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <DomainHeader title="创作者管理" subtitle={canWrite ? "审核创作者申请并查看等级分布。" : "当前角色仅可查看创作者资料。"} />
      <form className="mb-6 grid gap-3 rounded-2xl border border-[var(--line)] p-4 md:grid-cols-[1fr_200px_auto]" onSubmit={(event) => {
        event.preventDefault();
        router.replace(`/admin/creators${params.size ? `?${params}` : ""}`);
        void load();
      }}>
        <input aria-label="搜索创作者" value={q} onChange={(event) => setQ(event.target.value)} placeholder="名称、账号或分类" className="rounded-xl border border-[var(--line)] bg-transparent px-3 py-2" />
        <select aria-label="创作者申请状态筛选" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2">
          <option value="">全部状态</option><option value="pending">pending</option><option value="approved">approved</option><option value="rejected">rejected</option>
        </select>
        <button type="submit" className="rounded-xl bg-[var(--text)] px-4 py-2 font-bold text-[var(--bg)]">筛选</button>
      </form>

      {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error && applications.length ? <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading && !applications.length ? <AdminPageState title="正在加载创作者资料…" /> : null}
      {error && !applications.length ? <AdminPageState title="无法加载创作者资料" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !applications.length ? <AdminPageState title="没有符合条件的创作者申请" /> : null}
      {applications.length ? (
        <AdminTable headers={["申请人", "分类", "联系方式", "状态", "操作"]}>
          {applications.map((application) => (
            <tr key={application.id}>
              <td className="px-4 py-3 font-black">{application.displayName}<p className="text-xs font-normal muted">@{application.user.handle}</p></td>
              <td className="px-4 py-3">{application.category}</td>
              <td className="px-4 py-3">{application.contact}</td>
              <td className="px-4 py-3"><AdminStatus tone={application.status === "pending" ? "warning" : application.status === "approved" ? "success" : "danger"}>{application.status}</AdminStatus></td>
              <td className="px-4 py-3">
                {canWrite && application.status === "pending" ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void review(application.id, "approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">通过</button>
                    <button type="button" onClick={() => void review(application.id, "rejected")} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">拒绝</button>
                  </div>
                ) : <span className="text-xs muted">只读</span>}
              </td>
            </tr>
          ))}
        </AdminTable>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-black">创作者等级</h2>
        {!levels.length && !loading ? <AdminPageState title="尚未配置创作者等级" /> : null}
        {levels.length ? (
          <AdminTable headers={["等级", "粉丝区间", "创作者数"]}>
            {levels.map((level) => (
              <tr key={level.id}>
                <td className="px-4 py-3 font-black">{level.name}<p className="text-xs font-normal muted">{level.id}</p></td>
                <td className="px-4 py-3">{level.minFollowers.toLocaleString()} – {level.maxFollowers?.toLocaleString() ?? "∞"}</td>
                <td className="px-4 py-3">{level._count?.creators ?? 0}</td>
              </tr>
            ))}
          </AdminTable>
        ) : null}
      </section>
    </div>
  );
}

function DomainHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="mb-8"><h1 className="text-3xl font-black">{title}</h1><p className="mt-2 text-sm muted">{subtitle}</p></header>;
}
