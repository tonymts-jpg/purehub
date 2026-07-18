import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { setLike } from "@/lib/social-repository";

async function update(request: Request, params: Promise<{ id: string }>, liked: boolean) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  if (!(await consumeRateLimit("like", session.user.id, 60, 60))) return NextResponse.json({ error: "Too many like changes." }, { status: 429 });
  try { return NextResponse.json(await setLike(session.user.id, (await params).id, liked)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update like." }, { status: 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return update(request, params, true); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return update(request, params, false); }
