import { NextResponse } from "next/server";
import { z } from "zod";
import { createPayoutRequest } from "@/lib/payments/repository";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  amount: z.number().int().min(100),
  channel: z.string().min(1)
});

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const payout = await createPayoutRequest({ ...schema.parse(await request.json()), userId: session.user.id });
    return NextResponse.json({ payout });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create payout request." }, { status: 400 });
  }
}
