import { NextResponse } from "next/server";
import { channelRouteError } from "@/lib/channels/http";
import { getChannelBySlug } from "@/lib/channels/repository";
import { normalizeChannelSlug } from "@/lib/channels/types";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = await getSessionUser(request);
    const slug = normalizeChannelSlug((await params).slug);
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const channel = await getChannelBySlug(slug, user?.id ?? null, cursor);
    if (!user) return NextResponse.json({ channel });
    const bookmark = await prisma.channelBookmark.findFirst({
      where: { userId: user.id, channel: { slug } },
      select: { id: true }
    });
    return NextResponse.json({
      channel: { ...channel, bookmarked: Boolean(bookmark) }
    });
  } catch (error) {
    return channelRouteError(error);
  }
}
