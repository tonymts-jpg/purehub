import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { activatePlatformFeeConfig } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const config = await activatePlatformFeeConfig(auth.admin, id);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to activate fee config." }, { status: 400 });
  }
}
