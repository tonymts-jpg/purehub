import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { channelListInput, channelRouteError, readChannelJson } from "@/lib/channels/http";
import { createChannel, listChannels } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides, validateChannelInput } from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "channels", "read");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await listChannels(channelListInput(request), auth.admin.actorUserId));
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels", "write");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const channel = await createChannel(
      auth.admin.actorUserId,
      validateChannelInput(input),
      auth.admin
    );
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    return channelRouteError(error);
  }
}
