import { NextResponse } from "next/server";
import { getCreator, getCreatorPosts } from "@/lib/db-repository";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const user = await getSessionUser(request);
  const creator = await getCreator(handle, user?.id);
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  const posts = await getCreatorPosts(creator.id, user?.id, { cursor, take: 20 });
  return NextResponse.json({ creator, posts: posts.slice(0, 20), nextCursor: posts.length > 20 ? posts[19].id : null });
}
