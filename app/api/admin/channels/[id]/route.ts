import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import { getAdminChannelById, updateAdminChannel } from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides, validateChannelPatchInput } from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const auth = await requireAdmin(request, "channels");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getAdminChannelById(auth.admin, (await params).id));
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const channel = await updateAdminChannel(
      auth.admin,
      (await params).id,
      validateChannelPatchInput(input, true)
    );
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
