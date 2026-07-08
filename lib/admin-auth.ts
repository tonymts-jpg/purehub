import { NextResponse } from "next/server";
import type { AdminRole } from "./platform-config";

export type AdminContext = {
  actorUserId: string;
  role: AdminRole;
};

const DEFAULT_ADMIN_TOKEN = "purehub-admin-demo-token";

const adminRoles: AdminRole[] = [
  "super_admin",
  "ops_admin",
  "content_admin",
  "finance_admin",
  "support_admin",
  "analyst"
];

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

function requestRole(request: Request): AdminRole {
  const role = request.headers.get("x-admin-role") as AdminRole | null;
  return role && adminRoles.includes(role) ? role : "super_admin";
}

export function requireAdmin(request: Request, section?: string): { ok: true; admin: AdminContext } | { ok: false; response: NextResponse } {
  const token = configuredToken();
  if (!token || requestToken(request) !== token) {
    return { ok: false, response: NextResponse.json({ error: "Admin token is required." }, { status: 401 }) };
  }

  const admin = { actorUserId: "admin-demo", role: requestRole(request) };
  if (section && !ADMIN_SECTIONS[admin.role].includes(section)) {
    return { ok: false, response: NextResponse.json({ error: "Admin role is not allowed for this section." }, { status: 403 }) };
  }

  return { ok: true, admin };
}

export function adminPermissions(role: AdminRole) {
  return ADMIN_SECTIONS[role];
}
