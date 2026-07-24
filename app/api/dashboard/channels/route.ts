import { NextResponse } from "next/server";
import {
  createChannel,
  getCreatorChannelQuota,
  listCreatorChannels
} from "@/lib/channels/repository";
import { channelListInput, channelRouteError, readChannelJson } from "@/lib/channels/http";
import { assertNoChannelIdentityOverrides, validateChannelInput } from "@/lib/channels/types";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const [channels, quota] = await Promise.all([
      listCreatorChannels(session.user.id, channelListInput(request)),
      getCreatorChannelQuota(session.user.id)
    ]);
    return NextResponse.json({ ...channels, quota });
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const channel = await createChannel(session.user.id, validateChannelInput(input));
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    return channelRouteError(error);
  }
}
