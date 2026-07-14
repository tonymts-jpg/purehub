import { NextResponse } from "next/server";
import { z } from "zod";
import { completeUpload } from "@/lib/storage/media";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const schema = z.object({ assetId: z.string(), userId: z.string().default("c1"), checksum: z.string().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), durationSeconds: z.number().int().nonnegative().optional(), simulate: z.boolean().optional() });
export async function POST(request: Request) {
  try {
    return NextResponse.json({ asset: await completeUpload(schema.parse(await request.json())) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete upload." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "c1";
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, uploaderUserId: userId }, select: { id: true, status: true, processingError: true } });
  return NextResponse.json({ assets });
}
