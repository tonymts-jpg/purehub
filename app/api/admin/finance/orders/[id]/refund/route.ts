import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { refundOrder } from "@/lib/finance/ledger";

const schema = z.object({ reason: z.string().min(3).max(500) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const { reason } = schema.parse(await request.json());
    return NextResponse.json({ refund: await refundOrder(auth.admin, id, reason) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to refund order." }, { status: 400 });
  }
}
