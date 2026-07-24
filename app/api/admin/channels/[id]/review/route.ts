import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import { reviewChannel } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new TypeError("Channel review input must be an object.");
    }
    if (Object.keys(input).some((field) => field !== "decision" && field !== "note")) {
      throw new TypeError("Channel review accepts only decision and note.");
    }
    const decision = "decision" in input ? input.decision : undefined;
    const note = "note" in input ? input.note : undefined;
    if (decision !== "approved" && decision !== "rejected") {
      throw new TypeError("Review decision is invalid.");
    }
    if (typeof note !== "string") throw new TypeError("Review note must be a string.");
    const channel = await reviewChannel(auth.admin, (await params).id, decision, note);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
