import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import { takeoverChannel } from "@/lib/channels/repository";
import {
  assertNoChannelIdentityOverrides,
  validateChannelTakeoverInput
} from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels", "write");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams, {
      allowBody: ["newOwnerUserId"]
    });
    const { newOwnerUserId } = validateChannelTakeoverInput(input);
    const channel = await takeoverChannel(auth.admin, (await params).id, newOwnerUserId);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
