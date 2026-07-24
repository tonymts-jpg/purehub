export const CHANNEL_KINDS = ["official", "creator"] as const;
export const CHANNEL_VISIBILITIES = ["public", "private"] as const;
export const CHANNEL_DISCOVERABILITY = ["discoverable", "hidden"] as const;
export const CHANNEL_STATUSES = ["draft", "pending", "active", "rejected", "suspended", "archived"] as const;
export const CHANNEL_ROLES = ["owner", "editor", "member"] as const;
export const CHANNEL_MEMBER_STATUSES = ["invited", "pending", "active", "rejected", "removed"] as const;
export const CHANNEL_POST_POLICIES = ["direct", "approval_required"] as const;
export const CHANNEL_RULE_KINDS = ["category", "tag", "creator"] as const;
export const CHANNEL_QUOTAS = { "level-1": 1, "level-2": 3, "level-3": 5 } as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];
export type ChannelDiscoverability = (typeof CHANNEL_DISCOVERABILITY)[number];
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export type ChannelRole = (typeof CHANNEL_ROLES)[number];
export type ChannelMemberStatus = (typeof CHANNEL_MEMBER_STATUSES)[number];
export type ChannelPostPolicy = (typeof CHANNEL_POST_POLICIES)[number];
export type ChannelRuleKind = (typeof CHANNEL_RULE_KINDS)[number];
export type ChannelLevelId = keyof typeof CHANNEL_QUOTAS;

export type ChannelAccess = {
  canRead: boolean;
  canManage: boolean;
  canCurate: boolean;
  canManageMembers: boolean;
  role: ChannelRole | null;
};

export type ChannelCursor = {
  scope: "channel-list" | "channel-feed";
  channelId: string | null;
  pinnedAt: string | null;
  position: number | null;
  createdAt: string;
  id: string;
};

export type SearchCursor = {
  rank: number;
  publishedAt: string;
  entityType: "post" | "creator" | "channel";
  entityId: string;
};

export type CreateChannelInput = {
  slug: string;
  name: string;
  description: string;
  kind?: ChannelKind;
  visibility: ChannelVisibility;
  discoverability: ChannelDiscoverability;
  memberPostPolicy: ChannelPostPolicy;
  avatarAssetId?: string | null;
  coverAssetId?: string | null;
};

export type ListChannelsInput = {
  cursor?: string;
  kind?: ChannelKind;
  visibility?: ChannelVisibility;
  status?: ChannelStatus;
  limit?: number;
};

export type ChannelOwnerDto = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
};

export type ChannelDto = {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatarAssetId: string | null;
  coverAssetId: string | null;
  kind: ChannelKind;
  visibility: ChannelVisibility;
  discoverability: ChannelDiscoverability;
  status: ChannelStatus;
  ownerUserId: string;
  createdByUserId: string;
  memberPostPolicy: ChannelPostPolicy;
  reviewNote: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: ChannelOwnerDto;
  access: ChannelAccess;
};

export type ChannelPostDto = {
  id: string;
  postId: string;
  source: "manual" | "rule";
  position: number | null;
  pinnedAt: string | null;
  createdAt: string;
  post: {
    id: string;
    creatorId: string;
    title: string;
    excerpt: string;
    cover: string;
    category: string;
    tags: string[];
    visibility: string;
    price: number | null;
    createdAt: string;
  };
};

export type ChannelDetailDto = ChannelDto & {
  posts: ChannelPostDto[];
  nextCursor: string | null;
};

export type ChannelSafeSummaryDto = {
  slug: string;
  name: string;
  description: string;
  kind: ChannelKind;
  visibility: "private";
  discoverability: "discoverable";
  status: "active";
};

export type ChannelListItemDto = ChannelDto | ChannelSafeSummaryDto;
export type ChannelDetailResultDto = ChannelDetailDto | ChannelSafeSummaryDto;

export type ChannelJobInput = {
  idempotencyKey: string;
  kind: "materialize_channel" | "index_entity" | "delete_index" | "reindex_all";
  channelId?: string | null;
  entityType?: "post" | "creator" | "channel" | null;
  entityId?: string | null;
  availableAt?: Date;
};

export type SearchInput = {
  query: string;
  type?: "post" | "creator" | "channel";
  cursor?: string;
  limit?: number;
};

export type SearchResult = {
  entityType: "post" | "creator" | "channel";
  entityId: string;
  title: string;
  summary: string;
  rank: number;
  publishedAt: string;
  href: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function optionalAssetId(value: unknown, field: string) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string or null.`);
  }
  return value.trim();
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value as T[number];
}

export type ChannelPatchInput = {
  slug?: string;
  name?: string;
  description?: string;
  visibility?: ChannelVisibility;
  discoverability?: ChannelDiscoverability;
  memberPostPolicy?: ChannelPostPolicy;
  avatarAssetId?: string | null;
  coverAssetId?: string | null;
  status?: "archived";
};

export type ChannelLifecycleAction = "suspend" | "restore" | "archive";

export function assertNoChannelIdentityOverrides(
  input: unknown,
  searchParams?: URLSearchParams,
  options: { allowBody?: readonly string[] } = {}
): void {
  if (isRecord(input)) {
    const allowed = new Set(options.allowBody ?? []);
    const field = Object.keys(input).find((candidate) =>
      !allowed.has(candidate) && isChannelIdentityKey(candidate)
    );
    if (field) throw new TypeError(`${field} is derived from authenticated context and must not be supplied.`);
  }
  if (searchParams) {
    const field = Array.from(searchParams.keys()).find(isChannelIdentityKey);
    if (field) throw new TypeError(`${field} is derived from authenticated context and must not be supplied.`);
  }
}

function isChannelIdentityKey(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (normalized === "email" || normalized.endsWith("email")) return true;
  if (!normalized.endsWith("id")) return false;
  return [
    "user",
    "actor",
    "owner",
    "creator",
    "admin",
    "reviewer",
    "reviewedby",
    "createdby",
    "invitedby",
    "acceptedby"
  ].some((marker) => normalized.includes(marker));
}

export function resolveChannelLifecycleTransition(
  action: ChannelLifecycleAction,
  status: ChannelStatus
): { status: ChannelStatus; changed: boolean; jobKind: "index_entity" | "delete_index" | null } {
  if (action === "suspend") {
    if (status === "suspended") return { status, changed: false, jobKind: null };
    if (status !== "active") throw new TypeError("Only active channels may be suspended.");
    return { status: "suspended", changed: true, jobKind: "delete_index" };
  }
  if (action === "restore") {
    if (status === "active") return { status, changed: false, jobKind: null };
    if (status !== "suspended") throw new TypeError("Only suspended channels may be restored.");
    return { status: "active", changed: true, jobKind: "index_entity" };
  }
  if (action === "archive") {
    if (status === "archived") return { status, changed: false, jobKind: null };
    return { status: "archived", changed: true, jobKind: "delete_index" };
  }
  throw new TypeError("Channel lifecycle action is invalid.");
}

export function resolveChannelIndexJob(
  channelId: string,
  status: ChannelStatus,
  version: string
): ChannelJobInput {
  if (typeof channelId !== "string" || !channelId) throw new TypeError("Channel ID is required for an index job.");
  if (!CHANNEL_STATUSES.some((candidate) => candidate === status)) {
    throw new TypeError("Channel status is invalid for an index job.");
  }
  if (!isIsoDate(version)) throw new TypeError("Channel job version must be an ISO timestamp.");
  const active = status === "active";
  return {
    idempotencyKey: `${active ? "index" : "delete-index"}:channel:${channelId}:${version}`,
    kind: active ? "index_entity" : "delete_index",
    channelId,
    entityType: "channel",
    entityId: channelId
  };
}

export function validateChannelPatchInput(input: unknown, allowArchive = false): ChannelPatchInput {
  if (!isRecord(input)) throw new TypeError("Channel update must be an object.");
  assertNoChannelIdentityOverrides(input);

  const allowed = new Set([
    "slug",
    "name",
    "description",
    "visibility",
    "discoverability",
    "memberPostPolicy",
    "avatarAssetId",
    "coverAssetId",
    ...(allowArchive ? ["status"] : [])
  ]);
  const unknownField = Object.keys(input).find((field) => !allowed.has(field));
  if (unknownField) throw new TypeError(`${unknownField} is not allowed in a channel update.`);
  if (Object.keys(input).length === 0) throw new TypeError("Channel update must include at least one field.");

  const result: ChannelPatchInput = {};
  if (input.slug !== undefined) result.slug = normalizeChannelSlug(typeof input.slug === "string" ? input.slug : "");
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 3 || name.length > 80) throw new TypeError("Channel name must be 3-80 characters.");
    result.name = name;
  }
  if (input.description !== undefined) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (description.length > 1000) throw new TypeError("Channel description must be at most 1000 characters.");
    result.description = description;
  }
  if (input.visibility !== undefined) {
    result.visibility = enumValue(input.visibility, CHANNEL_VISIBILITIES, "Channel visibility");
  }
  if (input.discoverability !== undefined) {
    result.discoverability = enumValue(input.discoverability, CHANNEL_DISCOVERABILITY, "Channel discoverability");
  }
  if (input.memberPostPolicy !== undefined) {
    result.memberPostPolicy = enumValue(input.memberPostPolicy, CHANNEL_POST_POLICIES, "Member post policy");
  }
  if (input.avatarAssetId !== undefined) result.avatarAssetId = optionalAssetId(input.avatarAssetId, "avatarAssetId");
  if (input.coverAssetId !== undefined) result.coverAssetId = optionalAssetId(input.coverAssetId, "coverAssetId");
  if (input.status !== undefined) {
    if (!allowArchive || input.status !== "archived") {
      throw new TypeError("Only archived status is allowed through channel update.");
    }
    result.status = "archived";
  }
  return result;
}

export function validateChannelTakeoverInput(input: unknown): { newOwnerUserId: string } {
  if (!isRecord(input)) throw new TypeError("Channel takeover input must be an object.");
  assertNoChannelIdentityOverrides(input, undefined, { allowBody: ["newOwnerUserId"] });
  if (Object.keys(input).some((field) => field !== "newOwnerUserId")) {
    throw new TypeError("Channel takeover accepts only newOwnerUserId.");
  }
  const newOwnerUserId = typeof input.newOwnerUserId === "string" ? input.newOwnerUserId.trim() : "";
  if (!newOwnerUserId || newOwnerUserId.length > 191) {
    throw new TypeError("newOwnerUserId must be a non-empty user ID.");
  }
  return { newOwnerUserId };
}

export function validateQuotaOverrideInput(input: unknown): { maxChannels: number; reason: string } {
  if (!isRecord(input)) throw new TypeError("Quota override input must be an object.");
  assertNoChannelIdentityOverrides(input);
  if (Object.keys(input).some((field) => field !== "maxChannels" && field !== "reason")) {
    throw new TypeError("Quota override accepts only maxChannels and reason.");
  }
  if (!Number.isInteger(input.maxChannels) || (input.maxChannels as number) < 0 || (input.maxChannels as number) > 100) {
    throw new TypeError("maxChannels must be an integer between 0 and 100.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 500) throw new TypeError("reason must be 1-500 characters.");
  return { maxChannels: input.maxChannels as number, reason };
}

export function parseChannelCursor(value?: string): ChannelCursor | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(decoded)) return null;
    if (decoded.scope !== "channel-list" && decoded.scope !== "channel-feed") return null;
    if (decoded.scope === "channel-list" && decoded.channelId !== null) return null;
    if (decoded.scope === "channel-feed" && (typeof decoded.channelId !== "string" || !decoded.channelId)) return null;
    if (decoded.pinnedAt !== null && !isIsoDate(decoded.pinnedAt)) return null;
    if (
      decoded.position !== null
      && (
        !Number.isInteger(decoded.position)
        || (decoded.position as number) < -2_147_483_648
        || (decoded.position as number) > 2_147_483_647
      )
    ) return null;
    if (!isIsoDate(decoded.createdAt) || typeof decoded.id !== "string" || !decoded.id) return null;
    return {
      scope: decoded.scope,
      channelId: decoded.channelId as string | null,
      pinnedAt: decoded.pinnedAt,
      position: decoded.position as number | null,
      createdAt: decoded.createdAt,
      id: decoded.id
    };
  } catch {
    return null;
  }
}

export function encodeChannelCursor(value: ChannelCursor): string {
  const valid = parseChannelCursor(Buffer.from(JSON.stringify(value)).toString("base64url"));
  if (!valid) throw new TypeError("Channel cursor is invalid.");
  return Buffer.from(JSON.stringify(valid)).toString("base64url");
}

export function channelCursorMatchesScope(
  cursor: ChannelCursor,
  scope: ChannelCursor["scope"],
  channelId?: string
): boolean {
  if (cursor.scope !== scope) return false;
  if (scope === "channel-list") return cursor.channelId === null;
  return typeof channelId === "string" && cursor.channelId === channelId;
}

export function projectChannelSafeSummary(input: {
  slug: string;
  name: string;
  description: string;
  kind: string;
  visibility: string;
  discoverability: string;
  status: string;
} & Record<string, unknown>): ChannelSafeSummaryDto {
  if (
    input.visibility !== "private"
    || input.discoverability !== "discoverable"
    || input.status !== "active"
    || !CHANNEL_KINDS.some((kind) => kind === input.kind)
  ) {
    throw new TypeError("Only active discoverable private channels have a safe summary.");
  }
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    kind: input.kind as ChannelKind,
    visibility: "private",
    discoverability: "discoverable",
    status: "active"
  };
}

export function normalizeChannelSlug(value: string): string {
  if (typeof value !== "string") throw new TypeError("Channel slug must be a string.");
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) {
    throw new TypeError("Channel slug must be 3-50 lowercase ASCII letters, digits, or hyphens.");
  }
  return slug;
}

export function validateChannelInput(input: unknown): CreateChannelInput {
  if (!isRecord(input)) throw new TypeError("Channel input must be an object.");

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 3 || name.length > 80) throw new TypeError("Channel name must be 3-80 characters.");

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 1000) throw new TypeError("Channel description must be at most 1000 characters.");

  const result: CreateChannelInput = {
    slug: normalizeChannelSlug(typeof input.slug === "string" ? input.slug : ""),
    name,
    description,
    visibility: input.visibility === undefined
      ? "public"
      : enumValue(input.visibility, CHANNEL_VISIBILITIES, "Channel visibility"),
    discoverability: input.discoverability === undefined
      ? "discoverable"
      : enumValue(input.discoverability, CHANNEL_DISCOVERABILITY, "Channel discoverability"),
    memberPostPolicy: input.memberPostPolicy === undefined
      ? "approval_required"
      : enumValue(input.memberPostPolicy, CHANNEL_POST_POLICIES, "Member post policy")
  };

  if (input.kind !== undefined) result.kind = enumValue(input.kind, CHANNEL_KINDS, "Channel kind");
  if (input.avatarAssetId !== undefined) result.avatarAssetId = optionalAssetId(input.avatarAssetId, "avatarAssetId");
  if (input.coverAssetId !== undefined) result.coverAssetId = optionalAssetId(input.coverAssetId, "coverAssetId");
  return result;
}
