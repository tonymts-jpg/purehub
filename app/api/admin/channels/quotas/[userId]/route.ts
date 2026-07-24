import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { channelRouteError, readChannelJson } from "@/lib/channels/http";
import {
  getAdminChannelQuota,
  setChannelQuotaOverride
} from "@/lib/channels/repository";
import {
  assertNoChannelIdentityOverrides,
  validateQuotaOverrideInput
} from "@/lib/channels/types";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Context) {
  const auth = await requireAdmin(request, "channels");
  if (!auth.ok) return auth.response;
  try {
    const quota = await getAdminChannelQuota(auth.admin, (await params).userId);
    return NextResponse.json({ quota });
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels");
  if (!auth.ok) return auth.response;
  try {
    const input = await readChannelJson(request);
    assertNoChannelIdentityOverrides(input, new URL(request.url).searchParams);
    const result = await setChannelQuotaOverride(
      auth.admin,
      (await params).userId,
      validateQuotaOverrideInput(input)
    );
    return NextResponse.json(result);
  } catch (error) {
    return channelRouteError(error);
  }
}
