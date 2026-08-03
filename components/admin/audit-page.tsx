"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type RequestError = Error & { status?: number };
type AuditLog = {
  id: string;
  actorUserId?: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};
type AuditResponse = { logs: AuditLog[]; nextCursor: string | null };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`) as RequestError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export async function loadAdminAudit(params: URLSearchParams, fetcher: Fetcher = fetch) {
  const query = new URLSearchParams();
  const cursor = params.get("cursor")?.trim();
  if (cursor) query.set("cursor", cursor);
  return readJson<AuditResponse>(await fetcher(`/api/admin/audit-logs${query.size ? `?${query}` : ""}`));
}

export function AuditPage({ initialCursor = "" }: { initialCursor?: string }) {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const params = useMemo(() => {
    const value = new URLSearchParams();
    if (initialCursor) value.set("cursor", initialCursor);
    return value;
  }, [initialCursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminAudit(params);
      setLogs(body.logs);
      setNextCursor(body.nextCursor);
    } catch (caught) {
      const requestError = caught as RequestError;
      if (requestError.status === 401) {
        router.replace("/admin/sign-in");
        return;
      }
      setError(requestError.status === 403 ? "当前管理员没有查看审计日志的权限。" : requestError.message || "无法加载审计日志。");
    } finally {
      setLoading(false);
    }
  }, [params, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8"><h1 className="text-3xl font-black">审计日志</h1><p className="mt-2 text-sm muted">只读查看管理员操作的参与者、动作、时间、目标与结果。</p></header>
      {loading && !logs.length ? <AdminPageState title="正在加载审计日志…" /> : null}
      {error && !logs.length ? <AdminPageState title="无法加载审计日志" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !logs.length ? <AdminPageState title="暂无审计日志" /> : null}
      {error && logs.length ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-500 px-3 py-1 font-bold">重试</button></div> : null}
      {logs.length ? (
        <>
          <div data-testid="audit-desktop-table" className="hidden md:block">
            <AdminTable headers={["参与者", "动作", "时间", "目标", "结果"]}>
              {logs.map((log) => <tr key={log.id}><td className="px-4 py-3 font-black">{log.actorUserId ?? "系统"}<p className="text-xs font-normal muted">{log.actorRole}</p></td><td className="px-4 py-3">{log.action}</td><td className="px-4 py-3 text-xs">{new Date(log.createdAt).toLocaleString("zh-CN")}</td><td className="px-4 py-3">{log.targetType}<p className="text-xs muted">{log.targetId}</p></td><td className="px-4 py-3"><AdminStatus tone={auditResult(log.metadata) === "失败" ? "danger" : "success"}>{auditResult(log.metadata)}</AdminStatus></td></tr>)}
            </AdminTable>
          </div>
          <div data-testid="audit-mobile-list" className="space-y-3 md:hidden">
            {logs.map((log) => <article key={log.id} className="rounded-2xl border border-[var(--line)] p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-black">{log.action}</h2><p className="text-xs muted">{log.actorUserId ?? "系统"} · {log.actorRole}</p></div><AdminStatus tone={auditResult(log.metadata) === "失败" ? "danger" : "success"}>{auditResult(log.metadata)}</AdminStatus></div><dl className="mt-3 grid gap-2 text-sm"><div><dt className="muted">时间</dt><dd>{new Date(log.createdAt).toLocaleString("zh-CN")}</dd></div><div><dt className="muted">目标</dt><dd>{log.targetType}:{log.targetId}</dd></div></dl></article>)}
          </div>
          {nextCursor ? <button type="button" onClick={() => router.replace(`/admin/audit?cursor=${encodeURIComponent(nextCursor)}`)} className="mt-4 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">下一页</button> : null}
        </>
      ) : null}
    </div>
  );
}

function auditResult(metadata: unknown) {
  if (metadata && typeof metadata === "object") {
    const value = metadata as Record<string, unknown>;
    if (value.result === "failed" || value.status === "failed" || value.success === false) return "失败";
  }
  return "成功";
}
