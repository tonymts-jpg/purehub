import { NextResponse } from "next/server";
import { getFeed } from "@/lib/db-repository";
import type { ContentCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") as ContentCategory | null;
  const posts = await getFeed(category ? { category } : undefined);
  return NextResponse.json({ posts });
}
