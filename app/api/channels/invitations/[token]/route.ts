import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
import { channelMembershipRateLimit } from "@/lib/channels/membership";
import {
  acceptChannelInvitation,
  rejectChannelInvitation
} from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ token: string }> };

async function invitationMutation(request: Request, { params }: Context, action: "accept" | "reject") {
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
    const policy = channelMembershipRateLimit("invite-accept", session.user.id);
    if (!(await consumeRateLimit(policy.scope, policy.subject, policy.limit, policy.windowSeconds))) {
      return NextResponse.json({ error: "Too many channel invitation attempts." }, { status: 429 });
    }
    const token = (await params).token;
    const result = action === "accept"
      ? await acceptChannelInvitation({ id: session.user.id, email: session.user.email }, token)
      : await rejectChannelInvitation({ id: session.user.id, email: session.user.email }, token);
    return NextResponse.json(result);
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function POST(request: Request, context: Context) {
  return invitationMutation(request, context, "accept");
}

export async function DELETE(request: Request, context: Context) {
  return invitationMutation(request, context, "reject");
}
