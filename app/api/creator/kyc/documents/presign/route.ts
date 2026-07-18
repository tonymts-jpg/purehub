import { NextResponse } from "next/server";
import { z } from "zod";
import { createKycDocumentUpload } from "@/lib/storage/media";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const runtime = "nodejs";
const schema = z.object({ fileName: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]) });
export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    return NextResponse.json(await createKycDocumentUpload({ ...schema.parse(await request.json()), userId: session.user.id }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create KYC document upload." }, { status: 400 });
  }
}
