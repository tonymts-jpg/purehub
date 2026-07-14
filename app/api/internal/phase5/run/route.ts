import { NextResponse } from "next/server";
import { runReconciliation, settleDueRevenue } from "@/lib/finance/ledger";
import { processPendingMedia } from "@/lib/storage/media";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const expected = process.env.WORKER_ACCESS_TOKEN;
  if (!expected || request.headers.get("x-worker-token") !== expected) return NextResponse.json({ error: "Worker token is required." }, { status: 401 });
  const action = new URL(request.url).searchParams.get("action") ?? "all";
  const result: Record<string, unknown> = {};
  if (action === "all" || action === "settle") result.settlement = await settleDueRevenue();
  if (action === "all" || action === "media") result.media = await processPendingMedia();
  if (action === "reconcile") result.reconciliation = await runReconciliation();
  return NextResponse.json(result);
}
