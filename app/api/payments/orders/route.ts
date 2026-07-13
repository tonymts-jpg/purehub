import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrder } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  buyerUserId: z.string().optional(),
  kind: z.enum(["post_unlock", "subscription"]),
  itemId: z.string(),
  currency: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const order = await createOrder(schema.parse(await request.json()));
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create order." }, { status: 400 });
  }
}
