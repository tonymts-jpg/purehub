import { NextResponse } from "next/server";
import {
  accountRouteError,
  requireEmptyAccountMutation,
  requireEmptyAccountQuery
} from "@/lib/account/http";
import { setChannelBookmark } from "@/lib/account/repository";
import { normalizeChannelSlug } from "@/lib/channels/types";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function update(
  request: Request,
  params: Promise<{ slug: string }>,
  bookmarked: boolean
) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;

  try {
    requireEmptyAccountQuery(request);
    await requireEmptyAccountMutation(request);
    const slug = normalizeChannelSlug((await params).slug);
    return NextResponse.json(await setChannelBookmark(session.user.id, slug, bookmarked));
  } catch (error) {
    return accountRouteError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return update(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return update(request, params, false);
}
