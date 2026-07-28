import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { storeUploadContent } from "@/lib/storage/media";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;

  const mimeType = request.headers.get("content-type") ?? "";
  const sizeBytes = Number(request.headers.get("content-length"));
  if (!request.body || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "A valid upload body and Content-Length are required." }, { status: 400 });
  }

  try {
    const { id } = await params;
    await storeUploadContent({
      assetId: id,
      userId: session.user.id,
      mimeType,
      sizeBytes,
      body: Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to store upload." },
      { status: 400 }
    );
  }
}
