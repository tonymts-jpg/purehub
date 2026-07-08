import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { updateCreatorLevel } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(2).optional(),
  minFollowers: z.number().int().nonnegative().optional(),
  maxFollowers: z.number().int().nonnegative().nullable().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request, "levels");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const level = await updateCreatorLevel(auth.admin, id, schema.parse(await request.json()));
  return NextResponse.json({ level });
}
