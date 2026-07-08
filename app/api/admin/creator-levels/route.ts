import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createCreatorLevel, listCreatorLevels } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  id: z.string().min(3),
  name: z.string().min(2),
  minFollowers: z.number().int().nonnegative(),
  maxFollowers: z.number().int().nonnegative().nullable().optional()
});

export async function GET(request: Request) {
  const auth = requireAdmin(request, "levels");
  if (!auth.ok) return auth.response;

  const levels = await listCreatorLevels();
  return NextResponse.json({ levels });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request, "levels");
  if (!auth.ok) return auth.response;

  const level = await createCreatorLevel(auth.admin, schema.parse(await request.json()));
  return NextResponse.json({ level }, { status: 201 });
}
