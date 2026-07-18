import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listCreatorApplications } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "applications");
  if (!auth.ok) return auth.response;

  const applications = await listCreatorApplications();
  return NextResponse.json({ applications });
}
