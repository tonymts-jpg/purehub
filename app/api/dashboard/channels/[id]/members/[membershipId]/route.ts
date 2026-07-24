import { NextResponse } from "next/server";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import { validateMembershipUpdateInput } from "@/lib/channels/membership";
import { updateChannelMembership } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; membershipId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const route = await params;
    const membership = await updateChannelMembership(
      session.user.id,
      route.id,
      route.membershipId,
      validateMembershipUpdateInput(input)
    );
    return NextResponse.json({ membership });
  } catch (error) {
    return channelRouteError(error);
  }
}
