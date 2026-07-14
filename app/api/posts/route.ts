import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_CATEGORIES } from "@/lib/categories";
import { createPost, getFeed } from "@/lib/db-repository";
import { classifyMediaByDuration, isSaleModeAllowed } from "@/lib/platform-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  creatorId: z.string().optional(),
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

export async function GET() {
  const posts = await getFeed();
  return NextResponse.json({ posts });
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const contentType = body.durationSeconds === undefined ? body.contentType : classifyMediaByDuration(body.durationSeconds);

  if (!isSaleModeAllowed(contentType, body.saleMode)) {
    return NextResponse.json({ error: "Sale mode is not allowed for this content type." }, { status: 400 });
  }

  const post = await createPost({ ...body, contentType });
  return NextResponse.json({ post }, { status: 201 });
}
