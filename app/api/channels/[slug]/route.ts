import { NextResponse } from "next/server";
import { channelRouteError } from "@/lib/channels/http";
import { getChannelBySlug } from "@/lib/channels/repository";
import { normalizeChannelSlug } from "@/lib/channels/types";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = await getSessionUser(request);
    const slug = normalizeChannelSlug((await params).slug);
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const channel = await getChannelBySlug(slug, user?.id ?? null, cursor);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelRouteError(error);
  }
}
