import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listFinanceOrders, listFinanceRefunds } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "finance", "read");
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["view", "status"].includes(key)) || params.getAll("view").length !== 1 || params.getAll("status").length > 1) {
    return NextResponse.json({ error: "Finance transaction query is invalid." }, { status: 400 });
  }
  const view = params.get("view");
  const status = params.get("status")?.trim() || undefined;
  const allowedStatuses = view === "orders"
    ? new Set(["pending", "paid", "fulfilled", "failed"])
    : view === "refunds"
      ? new Set(["pending", "succeeded", "failed"])
      : null;
  if (!allowedStatuses || (status && !allowedStatuses.has(status))) {
    return NextResponse.json({ error: "Finance transaction query is invalid." }, { status: 400 });
  }
  try {
    return view === "orders"
      ? NextResponse.json({ orders: await listFinanceOrders(status) })
      : NextResponse.json({ refunds: await listFinanceRefunds(status) });
  } catch {
    return NextResponse.json({ error: "Unable to load finance records." }, { status: 500 });
  }
}
