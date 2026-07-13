import { NextResponse } from "next/server";
import { getOrder } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json({ order });
}
