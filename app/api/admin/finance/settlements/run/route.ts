import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { settleDueRevenue } from "@/lib/finance/ledger";

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "finance", "write");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await settleDueRevenue());
}
