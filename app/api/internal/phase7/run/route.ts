import { NextResponse } from "next/server";
import { runPhase7Jobs } from "@/lib/channels/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.WORKER_ACCESS_TOKEN;
  if (!expected || request.headers.get("x-worker-token") !== expected) {
    return NextResponse.json({ error: "Worker token is required." }, { status: 401 });
  }
  const searchParams = new URL(request.url).searchParams;
  const unsupported = Array.from(searchParams.keys()).find((field) => field !== "limit");
  if (unsupported) {
    return NextResponse.json({ error: `This request does not accept the ${unsupported} query parameter.` }, { status: 400 });
  }
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  try {
    return NextResponse.json(await runPhase7Jobs(limit));
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Phase 7 worker run failed." }, { status: 500 });
  }
}
