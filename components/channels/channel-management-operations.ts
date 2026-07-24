import { channelApi } from "./channel-management-api";

export type ChannelOperation = {
  url: string;
  init: RequestInit;
};

export function officialChannelOperationsAvailable(kind: string, status: string) {
  return kind === "official" && status === "active";
}

function jsonOperation(url: string, method: "POST" | "PUT" | "PATCH", body: Record<string, unknown>): ChannelOperation {
  return { url, init: { method, body: JSON.stringify(body) } };
}

export const adminChannelOperations = {
  archive(channelId: string) {
    return jsonOperation(`/api/admin/channels/${channelId}`, "PATCH", { status: "archived" });
  },
  quota(ownerUserId: string, maxChannels: number, reason: string) {
    return jsonOperation(`/api/admin/channels/quotas/${ownerUserId}`, "PUT", { maxChannels, reason });
  },
  takeover(channelId: string, newOwnerUserId: string) {
    return jsonOperation(`/api/admin/channels/${channelId}/takeover`, "POST", { newOwnerUserId });
  },
  official(input: { slug: string; name: string; description: string }) {
    return jsonOperation("/api/admin/channels", "POST", {
      kind: "official",
      ...input,
      visibility: "public",
      discoverability: "discoverable",
      memberPostPolicy: "approval_required"
    });
  }
};

export function executeChannelOperation<T>(operation: ChannelOperation, signal?: AbortSignal) {
  return channelApi<T>(operation.url, operation.init, signal);
}
