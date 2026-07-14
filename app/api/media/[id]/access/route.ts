import { NextResponse } from "next/server";
import { mediaAccess } from "@/lib/storage/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get("userId") ?? undefined;
    return NextResponse.json(await mediaAccess(id, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to access media.";
    return NextResponse.json({ error: message }, { status: message.includes("authorized") ? 403 : 404 });
  }
}
