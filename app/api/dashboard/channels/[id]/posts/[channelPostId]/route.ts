import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
import {
  removeChannelPost,
  updateChannelPost,
  validateChannelPostPatchInput
} from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; channelPostId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides(input, searchParams);
    requireEmptyChannelQuery(searchParams);
    const route = await params;
    const channelPost = await updateChannelPost(
      session.user.id,
      route.id,
      route.channelPostId,
      validateChannelPostPatchInput(input)
    );
    return NextResponse.json({ channelPost });
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request, true);
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides(input, searchParams);
    requireEmptyChannelMutation(input);
    requireEmptyChannelQuery(searchParams);
    const route = await params;
    return NextResponse.json({
      channelPost: await removeChannelPost(session.user.id, route.id, route.channelPostId)
    });
  } catch (error) {
    return channelRouteError(error);
  }
}
