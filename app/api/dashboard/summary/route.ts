import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/db-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") ?? "c1";
  const summary = await getDashboardSummary(creatorId);
  return NextResponse.json(summary);
}
