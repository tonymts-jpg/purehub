import { NextResponse } from "next/server";
import { recordWebhook } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const providers = ["stripe", "paypal", "card", "alipay_intl", "wechatpay_intl", "usdt"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!providers.includes(provider as typeof providers[number])) {
      return NextResponse.json({ error: "Unknown payment provider." }, { status: 404 });
    }
    const payload = await request.json().catch(() => ({}));
    const event = await recordWebhook(provider as typeof providers[number], payload);
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process webhook." }, { status: 400 });
  }
}
