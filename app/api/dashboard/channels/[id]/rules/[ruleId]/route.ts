import { NextResponse } from "next/server";
import {
  channelRouteError,
  readChannelJson,
  requireEmptyChannelMutation,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
import {
  deleteChannelRule,
  updateChannelRule,
  validateChannelRuleMutationInput
} from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; ruleId: string }> };

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
    const rule = await updateChannelRule(
      session.user.id,
      route.id,
      route.ruleId,
      validateChannelRuleMutationInput(input, true)
    );
    return NextResponse.json({ rule });
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
    return NextResponse.json(await deleteChannelRule(session.user.id, route.id, route.ruleId));
  } catch (error) {
    return channelRouteError(error);
  }
}
