import { NextResponse } from "next/server";
import { mediaContent } from "@/lib/storage/media";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getSessionUser(request);
    const content = await mediaContent(id, user?.id, request.headers.get("range"));
    if (content.kind === "redirect") {
      return NextResponse.redirect(new URL(content.url, request.url), 307);
    }
    return new Response(content.body, {
      status: content.status,
      headers: {
        ...content.headers,
        "cache-control": content.isPublic ? "public, max-age=300" : "private, no-store",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load media.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("authorized") ? 403 : 404 }
    );
  }
}
