"use client";

import { Archive, Check, ChevronDown, Pin, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { channelApi, channelErrorMessage, loadEveryChannelPage } from "./channel-management-api";
import type {
  ManagedChannel,
  ManagedChannelExclusion,
  ManagedChannelPost,
  ManagedChannelRule,
  MutationRunner
} from "./channel-management-types";
import { ChannelIconButton, ChannelLoading, ChannelStatus } from "./channel-management-ui";

export function ChannelCurationManager({
  channel,
  runMutation
}: {
  channel: ManagedChannel;
  runMutation: MutationRunner;
}) {
  const [posts, setPosts] = useState<ManagedChannelPost[]>([]);
  const [rules, setRules] = useState<ManagedChannelRule[]>([]);
  const [exclusions, setExclusions] = useState<ManagedChannelExclusion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [postId, setPostId] = useState("");
  const [ruleKind, setRuleKind] = useState<ManagedChannelRule["kind"]>("category");
  const [ruleValue, setRuleValue] = useState("");
  const [excludedPostId, setExcludedPostId] = useState("");
  const [reason, setReason] = useState("");
  const prefix = `/api/dashboard/channels/${channel.id}`;

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const [postResult, ruleResult, exclusionResult] = await Promise.all([
        loadEveryChannelPage<ManagedChannelPost>(`${prefix}/posts`, "channelPosts", signal),
        loadEveryChannelPage<ManagedChannelRule>(`${prefix}/rules`, "rules", signal),
        loadEveryChannelPage<ManagedChannelExclusion>(`${prefix}/exclusions`, "exclusions", signal)
      ]);
      setPosts(postResult.items);
      setRules(ruleResult.items);
      setExclusions(exclusionResult.items);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(channelErrorMessage(caught));
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadVersion]);

  async function mutate(operation: () => Promise<unknown>, success: string) {
    const ok = await runMutation(operation, success, { refresh: false });
    if (ok) setReloadVersion((value) => value + 1);
    return ok;
  }

  const positioned = useMemo(
    () => posts
      .filter((post) => post.status === "active" && post.position !== null)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    [posts]
  );
  const positionById = new Map(positioned.map((post, index) => [post.id, index]));

  return (
    <section data-testid="channel-curation-manager" className="border-t border-[var(--line)] pt-6">
      <h3 className="text-lg font-black">策展管理</h3>
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
      {loading && <ChannelLoading>正在载入全部策展资料…</ChannelLoading>}
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0">
          <h4 className="font-bold">作品、顺序与置顶</h4>
          <form className="mt-2 flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => channelApi(`${prefix}/posts`, { method: "POST", body: JSON.stringify({ postId }) }),
              "作品已加入频道。"
            ).then((ok) => {
              if (ok) setPostId("");
            });
          }}>
            <input aria-label="作品 ID" required value={postId} onChange={(event) => setPostId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            <ChannelIconButton label="加入作品" type="submit"><Plus size={15}/></ChannelIconButton>
          </form>
          <ul className="mt-3 space-y-2">
            {posts.map((post) => {
              const activePosition = positionById.get(post.id);
              return (
                <li key={post.id} className="flex min-w-0 items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{post.postId}<span className="ml-1 text-xs muted">{post.source}</span></span>
                  <ChannelStatus value={post.status}/>
                  {post.status === "pending" && (
                    <>
                      <ChannelIconButton label={`通过作品 ${post.postId}`} onClick={() => void mutate(
                        () => channelApi(`${prefix}/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
                        "作品已通过。"
                      )}><Check size={14}/></ChannelIconButton>
                      <ChannelIconButton label={`拒绝作品 ${post.postId}`} onClick={() => void mutate(
                        () => channelApi(`${prefix}/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) }),
                        "作品已拒绝。"
                      )}><X size={14}/></ChannelIconButton>
                    </>
                  )}
                  {post.status === "active" && (
                    <ChannelIconButton label={`置顶作品 ${post.postId}`} onClick={() => void mutate(
                      () => channelApi(`${prefix}/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ pinned: !post.pinnedAt }) }),
                      "置顶状态已更新。"
                    )}><Pin size={14}/></ChannelIconButton>
                  )}
                  {activePosition !== undefined && (
                    <ChannelIconButton
                      label={`下移作品 ${post.postId}`}
                      disabled={activePosition === positioned.length - 1}
                      onClick={() => void mutate(
                        () => channelApi(`${prefix}/posts/${post.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ position: activePosition + 1 })
                        }),
                        "顺序已更新。"
                      )}
                    ><ChevronDown size={14}/></ChannelIconButton>
                  )}
                  {post.status === "active" && (
                    <ChannelIconButton label={`移除作品 ${post.postId}`} onClick={() => {
                      if (window.confirm("确认从频道移除这个作品？")) {
                        void mutate(
                          () => channelApi(`${prefix}/posts/${post.id}`, { method: "DELETE" }),
                          "作品已移除。"
                        );
                      }
                    }}><X size={14}/></ChannelIconButton>
                  )}
                </li>
              );
            })}
            {!posts.length && !loading && <li className="text-sm muted">尚无策展作品。</li>}
          </ul>
        </div>

        <div>
          <h4 className="font-bold">自动规则</h4>
          <form className="mt-2 grid grid-cols-[120px_1fr_auto] gap-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => channelApi(`${prefix}/rules`, {
                method: "POST",
                body: JSON.stringify({ kind: ruleKind, value: ruleValue, enabled: true })
              }),
              "规则已建立。"
            ).then((ok) => {
              if (ok) setRuleValue("");
            });
          }}>
            <select aria-label="规则类型" value={ruleKind} onChange={(event) => setRuleKind(event.target.value as ManagedChannelRule["kind"])} className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-2 text-sm">
              <option value="category">分类</option><option value="tag">标签</option><option value="creator">Creator</option>
            </select>
            <input aria-label="规则值" required value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="min-w-0 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            <ChannelIconButton label="新增规则" type="submit"><Plus size={15}/></ChannelIconButton>
          </form>
          <ul className="mt-3 space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                <span className="flex-1"><b>{rule.kind}</b> · {rule.value}</span>
                <ChannelStatus value={rule.enabled ? "enabled" : "disabled"}/>
                <ChannelIconButton label={`删除规则 ${rule.value}`} onClick={() => {
                  if (window.confirm("确认删除这项自动规则？")) {
                    void mutate(() => channelApi(`${prefix}/rules/${rule.id}`, { method: "DELETE" }), "规则已删除。");
                  }
                }}><X size={14}/></ChannelIconButton>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="font-bold">手动排除</h4>
          <form className="mt-2 space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () => channelApi(`${prefix}/exclusions`, {
                method: "POST",
                body: JSON.stringify({ postId: excludedPostId, reason })
              }),
              "作品已排除。"
            ).then((ok) => {
              if (ok) {
                setExcludedPostId("");
                setReason("");
              }
            });
          }}>
            <div className="flex gap-2">
              <input aria-label="排除作品 ID" required value={excludedPostId} onChange={(event) => setExcludedPostId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
              <ChannelIconButton label="新增排除" type="submit"><Archive size={15}/></ChannelIconButton>
            </div>
            <input aria-label="排除原因" required value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
          </form>
          <ul className="mt-3 space-y-2">
            {exclusions.map((exclusion) => (
              <li key={exclusion.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{exclusion.postId}<span className="ml-1 text-xs muted">{exclusion.reason}</span></span>
                <ChannelIconButton label={`取消排除 ${exclusion.postId}`} onClick={() => {
                  if (window.confirm("确认取消这项手动排除？")) {
                    void mutate(() => channelApi(`${prefix}/exclusions/${exclusion.id}`, { method: "DELETE" }), "排除已取消。");
                  }
                }}><X size={14}/></ChannelIconButton>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
