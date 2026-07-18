import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { setFollow } from "@/lib/social-repository";

async function update(request: Request, params: Promise<{ handle: string }>, following: boolean) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  if (!(await consumeRateLimit("follow", session.user.id, 30, 60))) return NextResponse.json({ error: "Too many follow changes." }, { status: 429 });
  try {
    return NextResponse.json(await setFollow(session.user.id, (await params).handle, following));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update follow." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ handle: string }> }) { return update(request, params, true); }
export async function DELETE(request: Request, { params }: { params: Promise<{ handle: string }> }) { return update(request, params, false); }
