import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation
} from "@/lib/channels/http";
import { transitionChannel } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels", "write");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request, true);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    requireEmptyChannelMutation(input);
    const channel = await transitionChannel(auth.admin, (await params).id, "restore");
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
