import { createHash, randomBytes } from "node:crypto";
import { assertNoChannelIdentityOverrides, type ChannelMemberStatus, type ChannelRole } from "./types";

export const CHANNEL_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "revoked"
] as const;

export type ChannelInvitationStatus = (typeof CHANNEL_INVITATION_STATUSES)[number];
export type MembershipReviewDecision = "approved" | "rejected";
export type MembershipUpdateInput = {
  role?: "editor" | "member";
  status?: "active" | "removed";
};

export type ChannelMemberCursor = {
  scope: "channel-members";
  channelId: string;
  createdAt: string;
  id: string;
};

export class ChannelMembershipError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409
  ) {
    super(message);
    this.name = "ChannelMembershipError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredId(value: unknown, field: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 191) throw new TypeError(`${field} must be a non-empty ID.`);
  return id;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function normalizeChannelInvitationEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    email.length < 3
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new TypeError("Invitation email is invalid.");
  }
  return email;
}

export function validateChannelInvitationInput(input: unknown): { email: string } {
  if (!isRecord(input)) throw new TypeError("Channel invitation input must be an object.");
  assertNoChannelIdentityOverrides(input, undefined, { allowBody: ["email"] });
  if (Object.keys(input).some((field) => field !== "email")) {
    throw new TypeError("Channel invitation accepts only email.");
  }
  return { email: normalizeChannelInvitationEmail(input.email) };
}

export function hashChannelInvitationToken(token: string): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(token)) {
    throw new TypeError("Invitation token is invalid.");
  }
  return createHash("sha256").update(token).digest("hex");
}

export function createChannelInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashChannelInvitationToken(token) };
}

export function validateMembershipReviewInput(input: unknown): {
  membershipId: string;
  decision: MembershipReviewDecision;
} {
  if (!isRecord(input)) throw new TypeError("Membership review input must be an object.");
  assertNoChannelIdentityOverrides(input);
  if (Object.keys(input).some((field) => field !== "membershipId" && field !== "decision")) {
    throw new TypeError("Membership review accepts only membershipId and decision.");
  }
  const membershipId = requiredId(input.membershipId, "membershipId");
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new TypeError("Membership review decision is invalid.");
  }
  return { membershipId, decision: input.decision };
}

export function validateMembershipUpdateInput(input: unknown): MembershipUpdateInput {
  if (!isRecord(input)) throw new TypeError("Membership update input must be an object.");
  assertNoChannelIdentityOverrides(input);
  if (Object.keys(input).some((field) => field !== "role" && field !== "status")) {
    throw new TypeError("Membership update accepts only role and status.");
  }
  if (Object.keys(input).length === 0) {
    throw new TypeError("Membership update must include role or status.");
  }
  const result: MembershipUpdateInput = {};
  if (input.role !== undefined) {
    if (input.role === "owner") throw new TypeError("Membership owner role cannot be assigned here.");
    if (input.role !== "editor" && input.role !== "member") {
      throw new TypeError("Membership role must be editor or member.");
    }
    result.role = input.role;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "removed") {
      throw new TypeError("Membership status must be active or removed.");
    }
    result.status = input.status;
  }
  return result;
}

export function resolveMembershipReviewTransition(
  status: ChannelMemberStatus,
  decision: MembershipReviewDecision
): { status: "active" | "rejected"; changed: boolean } {
  const target = decision === "approved" ? "active" : "rejected";
  if (status === target) return { status: target, changed: false };
  if (status !== "pending") {
    throw new ChannelMembershipError("Only pending membership requests may be reviewed.", 409);
  }
  return { status: target, changed: true };
}

export function resolveMembershipUpdateTransition(
  current: { role: ChannelRole; status: ChannelMemberStatus },
  input: MembershipUpdateInput
): { role: "editor" | "member"; status: "active" | "removed"; changed: boolean } {
  if (current.role === "owner") {
    throw new ChannelMembershipError("The channel owner membership cannot be changed here.", 409);
  }
  if (current.status !== "active" && current.status !== "removed") {
    throw new ChannelMembershipError("Only active or removed memberships may be changed.", 409);
  }
  const role = input.role ?? current.role;
  if (role !== "editor" && role !== "member") {
    throw new ChannelMembershipError("Membership role must be editor or member.", 409);
  }
  const status = input.status ?? current.status;
  if (status !== "active" && status !== "removed") {
    throw new ChannelMembershipError("Membership status must be active or removed.", 409);
  }
  return {
    role,
    status,
    changed: role !== current.role || status !== current.status
  };
}

export function resolveInvitationAcceptance(
  invitation: {
    status: ChannelInvitationStatus;
    email: string;
    expiresAt: Date;
  },
  sessionEmail: string,
  now = new Date()
): { status: "accepted"; changed: true } {
  if (normalizeChannelInvitationEmail(sessionEmail) !== normalizeChannelInvitationEmail(invitation.email)) {
    throw new ChannelMembershipError("Invitation email does not match the authenticated user.", 403);
  }
  const transition = resolveInvitationMutationTransition(invitation, "accept", now);
  if (transition.conflict) throw new ChannelMembershipError(transition.conflict, 409);
  return { status: "accepted", changed: true };
}

export function resolveInvitationMutationTransition(
  invitation: { status: ChannelInvitationStatus; expiresAt: Date },
  action: "accept" | "reject",
  now = new Date()
): {
  status: ChannelInvitationStatus;
  changed: boolean;
  conflict: string | null;
} {
  if (action === "reject" && invitation.status === "rejected") {
    return { status: "rejected", changed: false, conflict: null };
  }
  if (invitation.status !== "pending") {
    return {
      status: invitation.status,
      changed: false,
      conflict: `Invitation is ${invitation.status}.`
    };
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    return { status: "expired", changed: true, conflict: "Invitation is expired." };
  }
  return {
    status: action === "accept" ? "accepted" : "rejected",
    changed: true,
    conflict: null
  };
}

export function resolveMembershipMutationVisibility(
  action: "join" | "leave",
  channel: {
    exists: boolean;
    status: string | null;
    visibility: string | null;
    discoverability: string | null;
    hasActiveMembership: boolean;
    hasRemovedMembership: boolean;
  }
): { allowed: true } {
  if (!channel.exists) {
    throw new ChannelMembershipError("Channel not found.", 404);
  }
  const publiclyVisible = channel.status === "active"
    && (
      channel.visibility === "public"
      || (channel.visibility === "private" && channel.discoverability === "discoverable")
    );
  const hasRelevantAffiliation = action === "leave"
    ? channel.hasActiveMembership || channel.hasRemovedMembership
    : channel.hasActiveMembership;
  if (!hasRelevantAffiliation && !publiclyVisible) {
    throw new ChannelMembershipError("Channel not found.", 404);
  }
  return { allowed: true };
}

export function parseChannelMemberCursor(
  value?: string,
  expectedChannelId?: string
): ChannelMemberCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || !("scope" in parsed)
      || parsed.scope !== "channel-members"
      || !("channelId" in parsed)
      || typeof parsed.channelId !== "string"
      || !parsed.channelId
      || !("createdAt" in parsed)
      || !isIsoDate(parsed.createdAt)
      || !("id" in parsed)
      || typeof parsed.id !== "string"
      || !parsed.id
    ) {
      return null;
    }
    if (expectedChannelId && parsed.channelId !== expectedChannelId) {
      throw new TypeError("Membership cursor does not belong to this resource.");
    }
    return {
      scope: "channel-members",
      channelId: parsed.channelId,
      createdAt: parsed.createdAt,
      id: parsed.id
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("resource")) throw error;
    return null;
  }
}

export function encodeChannelMemberCursor(cursor: ChannelMemberCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  if (!parseChannelMemberCursor(encoded, cursor.channelId)) {
    throw new TypeError("Membership cursor is invalid.");
  }
  return encoded;
}

export function normalizeChannelMemberListInput(
  input: { cursor?: string; limit?: number },
  channelId: string
): { cursor: ChannelMemberCursor | null; limit: number } {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError("Membership limit must be an integer between 1 and 50.");
  }
  const cursor = input.cursor
    ? parseChannelMemberCursor(input.cursor, channelId)
    : null;
  if (input.cursor && !cursor) throw new TypeError("Membership cursor is invalid.");
  return { cursor, limit };
}

export function channelMembershipRateLimit(
  action: "join" | "invite" | "invite-accept",
  userId: string
): { scope: string; subject: string; limit: number; windowSeconds: 3600 } {
  const subject = requiredId(userId, "userId");
  const limits = {
    join: { scope: "channel-join", limit: 10 },
    invite: { scope: "channel-invite", limit: 50 },
    "invite-accept": { scope: "channel-invite-accept", limit: 20 }
  } as const;
  return { ...limits[action], subject, windowSeconds: 3600 };
}
