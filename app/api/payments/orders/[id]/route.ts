import { NextResponse } from "next/server";
import { getOrder } from "@/lib/payments/repository";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.buyerUserId !== session.user.id && order.creatorUserId !== session.user.id) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json({ order });
}
