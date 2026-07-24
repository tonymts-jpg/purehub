import { CHANNEL_ADMIN_ROLES, isChannelAdminRole } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import type { AdminRole } from "@/lib/platform-config";
import type { ChannelAccess, ChannelRole, ChannelStatus, ChannelVisibility } from "./types";
import { CHANNEL_ROLES } from "./types";

const noAccess: ChannelAccess = {
  canRead: false,
  canManage: false,
  canCurate: false,
  canManageMembers: false,
  role: null
};

function isChannelRole(value: string): value is ChannelRole {
  return CHANNEL_ROLES.some((role) => role === value);
}

export function resolveChannelAccess(input: {
  status: ChannelStatus;
  visibility: ChannelVisibility;
  role: ChannelRole | null;
  adminRole: AdminRole | null;
}): ChannelAccess {
  if (input.adminRole && isChannelAdminRole(input.adminRole)) {
    return { canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: null };
  }
  if (input.status === "suspended" || input.status === "archived") return { ...noAccess };

  if (input.role === "owner") {
    if (input.status === "active") {
      return { canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: "owner" };
    }
    return {
      canRead: true,
      canManage: input.status === "draft" || input.status === "rejected",
      canCurate: false,
      canManageMembers: false,
      role: "owner"
    };
  }
  if (input.role === "editor") {
    return {
      canRead: true,
      canManage: false,
      canCurate: input.status === "active",
      canManageMembers: false,
      role: "editor"
    };
  }
  if (input.role === "member" && input.status === "active") {
    return { canRead: true, canManage: false, canCurate: false, canManageMembers: false, role: "member" };
  }
  if (input.status === "active" && input.visibility === "public") return { ...noAccess, canRead: true };
  return { ...noAccess };
}

export async function getChannelAccess(userId: string | null, channelId: string): Promise<ChannelAccess> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      status: true,
      visibility: true,
      memberships: userId
        ? {
            where: { userId, status: "active", user: { status: "active" } },
            take: 1,
            select: { role: true }
          }
        : false
    }
  });
  if (!channel) return { ...noAccess };

  let adminRole: AdminRole | null = null;
  if (userId) {
    const admin = await prisma.adminAccount.findFirst({
      where: {
        userId,
        status: "active",
        role: { in: [...CHANNEL_ADMIN_ROLES] },
        user: { status: "active" }
      },
      orderBy: { createdAt: "asc" },
      select: { role: true }
    });
    if (admin && isChannelAdminRole(admin.role)) adminRole = admin.role;
  }

  const membershipRole = channel.memberships?.[0]?.role;
  const role = membershipRole && isChannelRole(membershipRole) ? membershipRole : null;
  return resolveChannelAccess({
    status: channel.status as ChannelStatus,
    visibility: channel.visibility as ChannelVisibility,
    role,
    adminRole
  });
}
