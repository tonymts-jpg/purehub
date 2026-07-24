import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation
} from "@/lib/channels/http";
import { leaveChannelMembership } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides, normalizeChannelSlug } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request, true);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    requireEmptyChannelMutation(input);
    return NextResponse.json(await leaveChannelMembership(
      session.user.id,
      normalizeChannelSlug((await params).slug)
    ));
  } catch (error) {
    return channelRouteError(error);
  }
}
