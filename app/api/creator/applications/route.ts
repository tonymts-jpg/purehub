import { NextResponse } from "next/server";
import { z } from "zod";
import { createCreatorApplication } from "@/lib/db-repository";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  displayName: z.string().min(2),
  category: z.string().min(2),
  portfolio: z.string().min(3),
  contact: z.string().min(3),
  note: z.string().optional()
});

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  const application = await createCreatorApplication({ ...schema.parse(await request.json()), userId: session.user.id });
  return NextResponse.json({ application }, { status: 201 });
}
