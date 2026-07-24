import { NextResponse } from "next/server";
import {
  getCreatorChannelById,
  updateCreatorChannel
} from "@/lib/channels/repository";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import { assertNoChannelIdentityOverrides, validateChannelPatchInput } from "@/lib/channels/types";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const channel = await getCreatorChannelById(session.user.id, (await params).id);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const channel = await updateCreatorChannel(
      session.user.id,
      (await params).id,
      validateChannelPatchInput(input)
    );
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
