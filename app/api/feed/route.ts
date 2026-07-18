import { NextResponse } from "next/server";
import { getFeed } from "@/lib/db-repository";
import type { ContentCategory } from "@/lib/categories";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") as ContentCategory | null;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const user = await getSessionUser(request);
  const posts = await getFeed({ ...(category ? { category } : {}), cursor, take: 20 }, user?.id);
  return NextResponse.json({ posts: posts.slice(0, 20), nextCursor: posts.length > 20 ? posts[19].id : null });
}
