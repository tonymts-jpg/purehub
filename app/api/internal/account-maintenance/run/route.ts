import { NextResponse } from "next/server";
import { deleteExpiredPostViews } from "@/lib/account/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.WORKER_ACCESS_TOKEN;
  if (!expected || request.headers.get("x-worker-token") !== expected) {
    return NextResponse.json({ error: "Worker token is required." }, { status: 401 });
  }
  return NextResponse.json(await deleteExpiredPostViews());
}
