import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listFinanceTransactions } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  const transactions = await listFinanceTransactions();
  return NextResponse.json({ transactions });
}
