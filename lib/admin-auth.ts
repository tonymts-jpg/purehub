import { NextResponse } from "next/server";
import type { AdminRole } from "./platform-config";
import { getSessionUser } from "./session";
import { prisma } from "./prisma";

export type AdminContext = {
  actorUserId: string;
  role: AdminRole;
};

const adminRoles: AdminRole[] = ["super_admin", "ops_admin", "content_admin", "finance_admin", "support_admin", "analyst"];
export const CHANNEL_ADMIN_ROLES = ["super_admin", "ops_admin", "content_admin"] as const;
export type ChannelAdminRole = (typeof CHANNEL_ADMIN_ROLES)[number];

export const ADMIN_SECTIONS = [
  "overview",
  "members",
  "creators",
  "content",
  "channels",
  "finance",
  "settings",
  "audit"
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export type AdminAccess = "read" | "write";

type AdminActionMatrix = Record<AdminRole, Partial<Record<AdminSection, readonly AdminAccess[]>>>;

const ADMIN_ACTION_MATRIX: AdminActionMatrix = {
  super_admin: {
    overview: ["read", "write"],
    members: ["read", "write"],
    creators: ["read", "write"],
    content: ["read", "write"],
    channels: ["read", "write"],
    finance: ["read", "write"],
    settings: ["read", "write"],
    audit: ["read", "write"]
  },
  ops_admin: {
    overview: ["read"],
    members: ["read", "write"],
    creators: ["read", "write"],
    content: ["read", "write"],
    channels: ["read", "write"],
    settings: ["read", "write"],
    audit: ["read"]
  },
  content_admin: {
    overview: ["read"],
    creators: ["read", "write"],
    content: ["read", "write"],
    channels: ["read", "write"],
    audit: ["read"]
  },
  finance_admin: {
    overview: ["read"],
    finance: ["read", "write"],
    settings: ["read", "write"],
    audit: ["read"]
  },
  support_admin: {
    overview: ["read"],
    members: ["read"],
    creators: ["read"]
  },
  analyst: {
    overview: ["read"],
    audit: ["read"]
  }
};

export function canAdminAccess(
  role: AdminRole,
  section: AdminSection,
  access: AdminAccess = "read"
) {
  return ADMIN_ACTION_MATRIX[role][section]?.includes(access) ?? false;
}

export function canAdminManageSettings(role: AdminRole, scope: "finance" | "operations") {
  if (role === "super_admin") return true;
  return scope === "finance" ? role === "finance_admin" : role === "ops_admin";
}

export async function requireAdmin(
  request: Request,
  section: AdminSection,
  access: AdminAccess = "read"
): Promise<
  { ok: true; admin: AdminContext } | { ok: false; response: NextResponse }
> {
  const actorUserId = (await getSessionUser(request))?.id ?? null;
  if (!actorUserId) {
    return { ok: false, response: NextResponse.json({ error: "Administrator authentication is required." }, { status: 401 }) };
  }

  const account = await prisma.adminAccount.findFirst({
    where: { userId: actorUserId, status: "active", role: { in: adminRoles } },
    orderBy: { createdAt: "asc" },
    select: { role: true }
  });
  if (!account) {
    return { ok: false, response: NextResponse.json({ error: "Active administrator access is required." }, { status: 403 }) };
  }

  const admin = { actorUserId, role: account.role as AdminRole };
  if (!canAdminAccess(admin.role, section, access)) {
    return { ok: false, response: NextResponse.json({ error: "Admin role is not allowed for this section and action." }, { status: 403 }) };
  }
  return { ok: true, admin };
}

export function adminPermissions(role: AdminRole) {
  return ADMIN_SECTIONS.filter((section) => canAdminAccess(role, section, "read"));
}

export function isChannelAdminRole(role: string): role is ChannelAdminRole {
  return CHANNEL_ADMIN_ROLES.some((channelRole) => channelRole === role);
}
