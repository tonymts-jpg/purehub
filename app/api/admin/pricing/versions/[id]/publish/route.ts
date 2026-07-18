import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { publishPricingVersion } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "pricing");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const version = await publishPricingVersion(auth.admin, id);
  return NextResponse.json({ version });
}
