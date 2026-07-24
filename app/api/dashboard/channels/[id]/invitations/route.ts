import { NextResponse } from "next/server";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import {
  channelMembershipRateLimit,
  validateChannelInvitationInput
} from "@/lib/channels/membership";
import { createChannelInvitation } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams, { allowBody: ["email"] });
    const validated = validateChannelInvitationInput(input);
    const policy = channelMembershipRateLimit("invite", session.user.id);
    if (!(await consumeRateLimit(policy.scope, policy.subject, policy.limit, policy.windowSeconds))) {
      return NextResponse.json({ error: "Too many channel invitations." }, { status: 429 });
    }
    const result = await createChannelInvitation(session.user.id, (await params).id, validated.email);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return channelRouteError(error);
  }
}
