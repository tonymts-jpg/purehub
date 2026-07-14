import { NextResponse } from "next/server";
import { z } from "zod";
import { createKycDocumentUpload } from "@/lib/storage/media";

export const runtime = "nodejs";
const schema = z.object({ userId: z.string().default("c1"), fileName: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]) });
export async function POST(request: Request) {
  try {
    return NextResponse.json(await createKycDocumentUpload(schema.parse(await request.json())), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create KYC document upload." }, { status: 400 });
  }
}
