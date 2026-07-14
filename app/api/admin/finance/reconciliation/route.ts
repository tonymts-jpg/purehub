import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listReconciliationRuns, runReconciliation } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ runs: await listReconciliationRuns() });
}
export async function POST(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ run: await runReconciliation() }, { status: 201 });
}
