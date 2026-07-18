import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { activateSettlementConfig } from "@/lib/finance/ledger";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json({ config: await activateSettlementConfig(auth.admin, id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to activate settlement config." }, { status: 400 });
  }
}
