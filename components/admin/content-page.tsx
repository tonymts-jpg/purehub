"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageState, AdminStatus, AdminTable } from "./admin-ui";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ContentRow = {
  id: string;
  title: string;
  category: string;
  visibility: string;
  moderationStatus: "pending" | "published" | "unpublished" | "hidden";
  commentCount: number;
  mediaCount: number;
  updatedAt: string;
  creator: { id: string; name: string; handle: string } | null;
};
type ContentResponse = { posts: ContentRow[]; nextCursor: string | null };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  return body as T;
}

export async function loadAdminContent(params: URLSearchParams, fetcher: Fetcher = fetch) {
  const query = new URLSearchParams();
  for (const key of ["status", "q", "cursor"]) {
    const value = params.get(key)?.trim();
    if (value) query.set(key, value);
  }
  return readJson<ContentResponse>(
    await fetcher(`/api/admin/content${query.size ? `?${query}` : ""}`)
  );
}

export function ContentPage({
  initialStatus = "",
  initialQ = "",
  initialCursor = "",
  canWrite
}: {
  initialStatus?: string;
  initialQ?: string;
  initialCursor?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState(initialQ);
  const [cursor, setCursor] = useState(initialCursor);
  const [posts, setPosts] = useState<ContentRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (q) next.set("q", q);
    if (cursor) next.set("cursor", cursor);
    return next;
  }, [cursor, q, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = await loadAdminContent(params);
      setPosts(body.posts);
      setNextCursor(body.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  async function moderate(id: string, action: "publish" | "unpublish" | "hide") {
    setError("");
    const response = await fetch(`/api/admin/content/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "内容审核失败，请重试。");
      return;
    }
    setMessage("内容审核状态已更新。");
    await load();
  }

  function navigate(nextCursorValue = "") {
    setCursor(nextCursorValue);
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (q) next.set("q", q);
    if (nextCursorValue) next.set("cursor", nextCursorValue);
    router.replace(`/admin/content${next.size ? `?${next}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <DomainHeader title="内容管理" subtitle={canWrite ? "审核作品、评论与媒体状态。" : "当前角色仅可查看内容资料。"} />
      <form className="mb-6 grid gap-3 rounded-2xl border border-[var(--line)] p-4 md:grid-cols-[1fr_220px_auto]" onSubmit={(event) => {
        event.preventDefault();
        navigate("");
        void load();
      }}>
        <input aria-label="搜索内容" value={q} onChange={(event) => setQ(event.target.value)} placeholder="标题、摘要或创作者" className="rounded-xl border border-[var(--line)] bg-transparent px-3 py-2" />
        <select aria-label="内容状态筛选" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2">
          <option value="">全部状态</option><option value="pending">pending</option><option value="published">published</option><option value="unpublished">unpublished</option><option value="hidden">hidden</option>
        </select>
        <button type="submit" className="rounded-xl bg-[var(--text)] px-4 py-2 font-bold text-[var(--bg)]">筛选</button>
      </form>

      {message ? <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error && posts.length ? <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading && !posts.length ? <AdminPageState title="正在加载内容…" /> : null}
      {error && !posts.length ? <AdminPageState title="无法加载内容" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !posts.length ? <AdminPageState title="没有符合条件的内容" /> : null}
      {posts.length ? (
        <>
          <AdminTable headers={["内容", "创作者", "状态 / 可见性", "评论", "媒体", "操作"]}>
            {posts.map((post) => (
              <tr key={post.id}>
                <td className="px-4 py-3 font-black">{post.title}<p className="text-xs font-normal muted">{post.category}</p></td>
                <td className="px-4 py-3">{post.creator?.name ?? "未知"}<p className="text-xs muted">@{post.creator?.handle ?? "unknown"}</p></td>
                <td className="px-4 py-3"><AdminStatus tone={post.moderationStatus === "published" ? "success" : post.moderationStatus === "pending" ? "warning" : "danger"}>{post.moderationStatus}</AdminStatus><p className="mt-1 text-xs muted">{post.visibility}</p></td>
                <td className="px-4 py-3">{post.commentCount}</td>
                <td className="px-4 py-3">{post.mediaCount}</td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void moderate(post.id, "publish")} className="rounded-lg border border-emerald-500 px-2 py-1 text-xs font-bold text-emerald-700">发布</button>
                      <button type="button" onClick={() => void moderate(post.id, "unpublish")} className="rounded-lg border border-amber-500 px-2 py-1 text-xs font-bold text-amber-700">下架</button>
                      <button type="button" onClick={() => void moderate(post.id, "hide")} className="rounded-lg border border-rose-500 px-2 py-1 text-xs font-bold text-rose-700">隐藏</button>
                    </div>
                  ) : <span className="text-xs muted">只读</span>}
                </td>
              </tr>
            ))}
          </AdminTable>
          {nextCursor ? (
            <button type="button" onClick={() => navigate(nextCursor)} className="mt-4 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">
              下一页
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DomainHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="mb-8"><h1 className="text-3xl font-black">{title}</h1><p className="mt-2 text-sm muted">{subtitle}</p></header>;
}
