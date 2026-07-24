import type { AdminRole } from "@/lib/platform-config";

export type ChannelAccess = {
  canRead: boolean;
  canManage: boolean;
  canCurate: boolean;
  canManageMembers: boolean;
  role: "owner" | "editor" | "member" | null;
};

export type ManagedChannel = {
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
  access: ChannelAccess;
};

export type ChannelQuota = {
  used: number;
  limit: number;
  levelId: string;
  overridden: boolean;
};

export type ChannelMembership = {
  id: string;
  channelId: string;
  userId: string;
  role: "owner" | "editor" | "member";
  status: "invited" | "pending" | "active" | "rejected" | "removed";
  user?: { id: string; name: string; handle: string; avatar: string };
};

export type ManagedChannelPost = {
  id: string;
  channelId: string;
  postId: string;
  source: "manual" | "rule";
  status: "pending" | "active" | "rejected" | "removed";
  position: number | null;
  pinnedAt: string | null;
};

export type ManagedChannelRule = {
  id: string;
  kind: "category" | "tag" | "creator";
  value: string;
  enabled: boolean;
};

export type ManagedChannelExclusion = {
  id: string;
  postId: string;
  reason: string;
};

export type InvitationReceipt = {
  invitation: { id: string; email: string; expiresAt: string };
  token: string;
};

export type AdminContext = { role: AdminRole; permissions: string[] } | null;

export type MutationRunner = (
  operation: () => Promise<unknown>,
  success: string,
  options?: { refresh?: boolean }
) => Promise<boolean>;
