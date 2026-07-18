import { NextResponse } from "next/server";
import { z } from "zod";
import { completeUpload } from "@/lib/storage/media";
import { prisma } from "@/lib/prisma";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const runtime = "nodejs";
const schema = z.object({ assetId: z.string(), checksum: z.string().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), durationSeconds: z.number().int().nonnegative().optional(), simulate: z.boolean().optional() });
export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    return NextResponse.json({ asset: await completeUpload({ ...schema.parse(await request.json()), userId: session.user.id }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete upload." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, uploaderUserId: session.user.id }, select: { id: true, status: true, processingError: true } });
  return NextResponse.json({ assets });
}
