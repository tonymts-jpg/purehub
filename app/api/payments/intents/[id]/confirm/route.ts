import { NextResponse } from "next/server";
import { confirmPaymentIntent } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const intent = await confirmPaymentIntent(id, payload);
    return NextResponse.json({ intent });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to confirm payment intent." }, { status: 400 });
  }
}
