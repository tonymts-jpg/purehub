import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrder } from "@/lib/payments/repository";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  kind: z.enum(["post_unlock", "subscription"]),
  itemId: z.string(),
  currency: z.string().optional()
});

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const order = await createOrder({ ...schema.parse(await request.json()), buyerUserId: session.user.id });
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create order." }, { status: 400 });
  }
}
