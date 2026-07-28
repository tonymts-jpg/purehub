import { NextResponse } from "next/server";
import { mediaContent } from "@/lib/storage/media";
import { MediaRangeError, resolveStaticMediaRedirect } from "@/lib/storage/media-policy";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getSessionUser(request);
    const content = await mediaContent(id, user?.id, request.headers.get("range"));
    if (content.kind === "redirect") {
      const response = NextResponse.redirect(resolveStaticMediaRedirect(content.url, request.url), 307);
      response.headers.set("cache-control", content.isPublic ? "public, max-age=300" : "private, no-store");
      response.headers.set("content-disposition", "inline");
      response.headers.set("x-content-type-options", "nosniff");
      return response;
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
    if (error instanceof MediaRangeError) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${error.size}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff"
        }
      });
    }
    const message = error instanceof Error ? error.message : "Unable to load media.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("authorized") ? 403 : 404 }
    );
  }
}
