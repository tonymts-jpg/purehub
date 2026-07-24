import { NextResponse } from "next/server";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import {
  listChannelMembers,
  reviewChannelMembership
} from "@/lib/channels/repository";
import { validateMembershipReviewInput } from "@/lib/channels/membership";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const memberships = await listChannelMembers(session.user.id, (await params).id);
    return NextResponse.json({ memberships });
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const review = validateMembershipReviewInput(input);
    const membership = await reviewChannelMembership(
      session.user.id,
      (await params).id,
      review.membershipId,
      review.decision
    );
    return NextResponse.json({ membership });
  } catch (error) {
    return channelRouteError(error);
  }
}
