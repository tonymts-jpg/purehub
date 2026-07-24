import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
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
    const channelId = (await params).id;
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides({}, searchParams);
    requireEmptyChannelQuery(searchParams, ["cursor", "limit"]);
    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = searchParams.get("limit");
    return NextResponse.json(await listChannelMembers(session.user.id, channelId, {
      ...(cursor ? { cursor } : {}),
      ...(rawLimit !== null ? { limit: Number(rawLimit) } : {})
    }));
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
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides(input, searchParams);
    requireEmptyChannelQuery(searchParams);
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
