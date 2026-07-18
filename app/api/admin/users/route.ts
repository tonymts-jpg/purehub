import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminUsers } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "users");
  if (!auth.ok) return auth.response;

  const users = await listAdminUsers();
  return NextResponse.json({ users });
}
