import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/db-repository";
import { requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  const summary = await getDashboardSummary(session.user.id);
  return NextResponse.json(summary);
}
