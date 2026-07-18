import { NextResponse } from "next/server";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { removeComment } from "@/lib/social-repository";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try { return NextResponse.json({ comment: await removeComment(session.user.id, (await params).id) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove comment.";
    return NextResponse.json({ error: message }, { status: message.includes("cannot") ? 403 : 404 });
  }
}
