import { NextResponse } from "next/server";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { setBookmark } from "@/lib/social-repository";

async function update(request: Request, params: Promise<{ id: string }>, bookmarked: boolean) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  try { return NextResponse.json(await setBookmark(session.user.id, (await params).id, bookmarked)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update bookmark." }, { status: 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return update(request, params, true); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return update(request, params, false); }
