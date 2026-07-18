import { NextResponse } from "next/server";
import type { AdminRole } from "./platform-config";
import { getSessionUser } from "./session";
import { prisma } from "./prisma";

export type AdminContext = {
  actorUserId: string;
  role: AdminRole;
};

const DEFAULT_ADMIN_TOKEN = "purehub-admin-demo-token";
const adminRoles: AdminRole[] = ["super_admin", "ops_admin", "content_admin", "finance_admin", "support_admin", "analyst"];

export const ADMIN_SECTIONS: Record<AdminRole, string[]> = {
  super_admin: ["overview", "users", "applications", "levels", "pricing", "transactions", "payments", "audit"],
  ops_admin: ["overview", "users", "applications", "levels", "pricing", "audit"],
  content_admin: ["overview", "applications", "levels", "audit"],
  finance_admin: ["overview", "transactions", "payments", "audit"],
  support_admin: ["overview", "users", "applications"],
  analyst: ["overview", "audit"]
};

function configuredToken() {
  if (process.env.ADMIN_ACCESS_TOKEN) return process.env.ADMIN_ACCESS_TOKEN;
  return process.env.NODE_ENV === "production" ? undefined : DEFAULT_ADMIN_TOKEN;
}

function requestToken(request: Request) {
  const headerToken = request.headers.get("x-admin-token");
  const authorization = request.headers.get("authorization");
  if (headerToken) return headerToken;
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return "";
}

async function resolveActorUserId(request: Request) {
  const token = configuredToken();
  if (token && requestToken(request) === token) return process.env.SERVICE_ADMIN_USER_ID ?? "admin-demo";
  return (await getSessionUser(request))?.id ?? null;
}

export async function requireAdmin(request: Request, section?: string): Promise<
  { ok: true; admin: AdminContext } | { ok: false; response: NextResponse }
> {
  const actorUserId = await resolveActorUserId(request);
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
  if (section && !ADMIN_SECTIONS[admin.role].includes(section)) {
    return { ok: false, response: NextResponse.json({ error: "Admin role is not allowed for this section." }, { status: 403 }) };
  }
  return { ok: true, admin };
}

export function adminPermissions(role: AdminRole) {
  return ADMIN_SECTIONS[role];
}
