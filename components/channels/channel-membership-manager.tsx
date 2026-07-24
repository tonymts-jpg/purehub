"use client";

import { Check, Clipboard, RotateCcw, UserMinus, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { channelApi, channelErrorMessage, loadEveryChannelPage } from "./channel-management-api";
import type {
  ChannelMembership,
  InvitationReceipt,
  ManagedChannel,
  MutationRunner
} from "./channel-management-types";
import { ChannelIconButton, ChannelLoading, ChannelStatus } from "./channel-management-ui";

export function ChannelMembershipManager({
  channel,
  canManage,
  runMutation
}: {
  channel: ManagedChannel;
  canManage: boolean;
  runMutation: MutationRunner;
}) {
  const [memberships, setMemberships] = useState<ChannelMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [email, setEmail] = useState("");
  const [receipt, setReceipt] = useState<InvitationReceipt | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true);
    setError("");
    return loadEveryChannelPage<ChannelMembership>(
      `/api/dashboard/channels/${channel.id}/members`,
      "memberships",
      signal
    ).then(({ items }) => setMemberships(items))
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(channelErrorMessage(caught));
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
  }, [channel.id]);

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

  async function invite() {
    setReceipt(null);
    setCopied(false);
    let invitationReceipt: InvitationReceipt | null = null;
    const ok = await runMutation(async () => {
      invitationReceipt = await channelApi<InvitationReceipt>(
        `/api/dashboard/channels/${channel.id}/invitations`,
        { method: "POST", body: JSON.stringify({ email }) }
      );
    }, "邀请已建立；请立即复制一次性链接。", { refresh: false });
    if (ok && invitationReceipt) {
      setReceipt(invitationReceipt);
      setEmail("");
    }
  }

  return (
    <section data-testid="channel-membership-manager" className="min-w-0 border-t border-[var(--line)] pt-5">
      <h3 className="font-black">成员与角色</h3>
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}

      {canManage && channel.visibility === "private" && (
        <div className="mt-3">
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}>
            <input aria-label="邀请邮箱" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"/>
            <ChannelIconButton label="发送频道邀请" type="submit"><UserPlus size={15}/>邀请</ChannelIconButton>
          </form>
          {receipt && (
            <div data-testid="invitation-receipt" className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
              <p className="text-sm font-black">一次性邀请链接</p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">此 token 只显示一次；请勿记录到日志、截图或长期储存。</p>
              <code className="mt-2 block break-all rounded bg-black/5 p-2 text-xs dark:bg-white/10">{`${window.location.origin}/api/channels/invitations/${receipt.token}`}</code>
              <ChannelIconButton label="复制一次性邀请链接" className="mt-2" onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}/api/channels/invitations/${receipt.token}`);
                setCopied(true);
              }}><Clipboard size={14}/>{copied ? "已复制" : "复制"}</ChannelIconButton>
            </div>
          )}
        </div>
      )}

      {loading && <ChannelLoading>正在载入全部成员…</ChannelLoading>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead><tr className="border-b border-[var(--line)]"><th className="p-2">成员</th><th className="p-2">状态</th><th className="p-2">角色</th><th className="p-2">操作</th></tr></thead>
          <tbody>
            {memberships.map((membership) => {
              const owner = membership.role === "owner" || membership.userId === channel.ownerUserId;
              const label = membership.user?.handle ?? membership.userId;
              return (
                <tr key={membership.id} className="border-b border-[var(--line)]/60">
                  <td className="p-2 font-bold">{membership.user?.name ?? membership.userId}<span className="ml-1 text-xs muted">@{label}</span></td>
                  <td className="p-2"><ChannelStatus value={membership.status}/></td>
                  <td className="p-2">
                    {canManage && membership.status === "active" && !owner ? (
                      <select
                        aria-label={`变更 ${label} 的角色`}
                        value={membership.role}
                        onChange={(event) => void mutate(
                          () => channelApi(`/api/dashboard/channels/${channel.id}/members/${membership.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ role: event.target.value })
                          }),
                          "成员角色已更新。"
                        )}
                        className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-xs"
                      >
                        <option value="editor">editor</option>
                        <option value="member">member</option>
                      </select>
                    ) : membership.role}
                  </td>
                  <td className="p-2">
                    {canManage && membership.status === "pending" && !owner && (
                      <span className="flex gap-1">
                        <ChannelIconButton label={`通过 ${label} 的加入申请`} onClick={() => void mutate(
                          () => channelApi(`/api/dashboard/channels/${channel.id}/members`, {
                            method: "POST",
                            body: JSON.stringify({ membershipId: membership.id, decision: "approved" })
                          }),
                          "加入申请已通过。"
                        )}><Check size={14}/></ChannelIconButton>
                        <ChannelIconButton label={`拒绝 ${label} 的加入申请`} onClick={() => void mutate(
                          () => channelApi(`/api/dashboard/channels/${channel.id}/members`, {
                            method: "POST",
                            body: JSON.stringify({ membershipId: membership.id, decision: "rejected" })
                          }),
                          "加入申请已拒绝。"
                        )}><X size={14}/></ChannelIconButton>
                      </span>
                    )}
                    {canManage && membership.status === "active" && !owner && (
                      <ChannelIconButton label={`移除成员 ${label}`} onClick={() => {
                        if (window.confirm(`确认移除 @${label}？`)) {
                          void mutate(
                            () => channelApi(`/api/dashboard/channels/${channel.id}/members/${membership.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: "removed" })
                            }),
                            "成员已移除。"
                          );
                        }
                      }}><UserMinus size={14}/></ChannelIconButton>
                    )}
                    {canManage && membership.status === "removed" && !owner && (
                      <ChannelIconButton label={`重新启用成员 ${label}`} onClick={() => void mutate(
                        () => channelApi(`/api/dashboard/channels/${channel.id}/members/${membership.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status: "active" })
                        }),
                        "成员已重新启用。"
                      )}><RotateCcw size={14}/></ChannelIconButton>
                    )}
                    {owner && <span className="text-xs muted">所有者受保护</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && !memberships.length && <tr><td colSpan={4} className="p-3 text-sm muted">暂无成员。</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
