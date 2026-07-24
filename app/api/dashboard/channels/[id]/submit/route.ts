import { NextResponse } from "next/server";
import { submitChannel } from "@/lib/channels/repository";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation
} from "@/lib/channels/http";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request, true);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    requireEmptyChannelMutation(input);
    const channel = await submitChannel(session.user.id, (await params).id);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
