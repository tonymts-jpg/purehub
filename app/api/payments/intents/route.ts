import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaymentIntent } from "@/lib/payments/repository";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  orderId: z.string(),
  provider: z.enum(["stripe", "paypal", "card", "alipay_intl", "wechatpay_intl", "usdt"])
});

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const intent = await createPaymentIntent({ ...schema.parse(await request.json()), buyerUserId: session.user.id });
    return NextResponse.json({ intent });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create payment intent." }, { status: 400 });
  }
}
