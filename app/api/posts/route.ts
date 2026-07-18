import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_CATEGORIES } from "@/lib/categories";
import { createPost, getFeed } from "@/lib/db-repository";
import { classifyMediaByDuration, isSaleModeAllowed } from "@/lib/platform-config";
import { enforceSameOrigin, getSessionUser, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  title: z.string().min(3),
  excerpt: z.string().min(8),
  content: z.string().min(20),
  category: z.enum(CONTENT_CATEGORIES),
  visibility: z.enum(["free", "members", "purchase"]),
  contentType: z.enum(["photo_short", "long_video"]).default("photo_short"),
  saleMode: z.enum(["single_plus_subscription", "subscription_only", "long_video_single"]).default("subscription_only"),
  price: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  mediaAssetIds: z.array(z.string()).max(20).optional()
});

export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const user = await getSessionUser(request);
  const posts = await getFeed({ cursor, take: 20 }, user?.id);
  return NextResponse.json({ posts: posts.slice(0, 20), nextCursor: posts.length > 20 ? posts[19].id : null });
}

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  const body = schema.parse(await request.json());
  const contentType = body.durationSeconds === undefined ? body.contentType : classifyMediaByDuration(body.durationSeconds);

  if (!isSaleModeAllowed(contentType, body.saleMode)) {
    return NextResponse.json({ error: "Sale mode is not allowed for this content type." }, { status: 400 });
  }

  const post = await createPost({ ...body, creatorId: session.user.id, contentType });
  return NextResponse.json({ post }, { status: 201 });
}
