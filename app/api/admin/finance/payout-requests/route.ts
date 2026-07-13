import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { listPayoutRequests, reviewPayoutRequest } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  id: z.string(),
  status: z.enum(["approved", "rejected", "paid"]),
  reviewNote: z.string().optional()
});

export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  const payouts = await listPayoutRequests();
  return NextResponse.json({ payouts });
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    const payout = await reviewPayoutRequest(auth.admin, schema.parse(await request.json()));
    return NextResponse.json({ payout });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review payout request." }, { status: 400 });
  }
}
