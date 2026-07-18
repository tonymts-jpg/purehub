import { NextResponse } from "next/server";
import { z } from "zod";
import { createUpload } from "@/lib/storage/media";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const runtime = "nodejs";
const schema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().regex(/^(image|video)\//), sizeBytes: z.number().int().positive().max(500_000_000),
  kind: z.enum(["image", "video"]), visibility: z.enum(["public", "members", "purchase"])
});
export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    const result = await createUpload({ ...schema.parse(await request.json()), userId: session.user.id });
    return NextResponse.json({ assetId: result.asset.id, status: result.asset.status, uploadUrl: result.uploadUrl, headers: result.headers }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create upload." }, { status: 400 });
  }
}
