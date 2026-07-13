import { NextResponse } from "next/server";
import { z } from "zod";
import { createPayoutRequest } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  userId: z.string().optional(),
  amount: z.number().int().min(100),
  channel: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const payout = await createPayoutRequest(schema.parse(await request.json()));
    return NextResponse.json({ payout });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create payout request." }, { status: 400 });
  }
}
