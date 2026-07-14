import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listLedgerTransactions } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  const referenceId = new URL(request.url).searchParams.get("referenceId") ?? undefined;
  return NextResponse.json({ transactions: await listLedgerTransactions(referenceId) });
}
