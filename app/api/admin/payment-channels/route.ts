import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listPaymentChannels } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "payments");
  if (!auth.ok) return auth.response;

  const channels = await listPaymentChannels();
  return NextResponse.json({ channels });
}
