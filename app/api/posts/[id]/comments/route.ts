import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/rate-limit";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { createComment, listComments } from "@/lib/social-repository";

const schema = z.object({ content: z.string().trim().min(1).max(1000) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  return NextResponse.json(await listComments((await params).id, cursor));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  if (!(await consumeRateLimit("comment", session.user.id, 20, 60))) return NextResponse.json({ error: "Too many comments." }, { status: 429 });
  try {
    const body = schema.parse(await request.json());
    return NextResponse.json({ comment: await createComment(session.user.id, (await params).id, body.content) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create comment." }, { status: 400 });
  }
}
