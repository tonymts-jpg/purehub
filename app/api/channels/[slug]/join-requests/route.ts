import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
import { channelMembershipRateLimit } from "@/lib/channels/membership";
import { requestChannelMembership } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides, normalizeChannelSlug } from "@/lib/channels/types";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request, true);
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides(input, searchParams);
    requireEmptyChannelQuery(searchParams);
    requireEmptyChannelMutation(input);
    const policy = channelMembershipRateLimit("join", session.user.id);
    if (!(await consumeRateLimit(policy.scope, policy.subject, policy.limit, policy.windowSeconds))) {
      return NextResponse.json({ error: "Too many channel join requests." }, { status: 429 });
    }
    const membership = await requestChannelMembership(
      session.user.id,
      normalizeChannelSlug((await params).slug)
    );
    return NextResponse.json({ membership });
  } catch (error) {
    return channelRouteError(error);
  }
}
