import { NextResponse } from "next/server";
import { channelRouteError, readChannelJson, requireEmptyChannelQuery } from "@/lib/channels/http";
import {
  createChannelRule,
  listChannelRules,
  validateChannelRuleMutationInput
} from "@/lib/channels/repository";
import { assertNoChannelIdentityOverrides } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides({}, searchParams);
    requireEmptyChannelQuery(searchParams, ["cursor", "limit"]);
    const rawLimit = searchParams.get("limit");
    return NextResponse.json(await listChannelRules(session.user.id, (await params).id, {
      ...(searchParams.get("cursor") ? { cursor: searchParams.get("cursor")! } : {}),
      ...(rawLimit !== null ? { limit: Number(rawLimit) } : {})
    }));
  } catch (error) {
    return channelRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try {
    const input = await readChannelJson(request);
    const searchParams = new URL(request.url).searchParams;
    assertNoChannelIdentityOverrides(input, searchParams);
    requireEmptyChannelQuery(searchParams);
    const rule = await createChannelRule(
      session.user.id,
      (await params).id,
      validateChannelRuleMutationInput(input) as Parameters<typeof createChannelRule>[2]
    );
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return channelRouteError(error);
  }
}
