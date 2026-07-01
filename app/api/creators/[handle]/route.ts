import { NextResponse } from "next/server";
import { getCreator, getCreatorPosts } from "@/lib/db-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const creator = await getCreator(handle);
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  const posts = await getCreatorPosts(creator.id);
  return NextResponse.json({ creator, posts });
}
