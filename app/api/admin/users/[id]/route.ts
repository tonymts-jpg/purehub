import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { updateAdminUser } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  role: z.enum(["fan", "creator", "admin"]).optional(),
  creatorStatus: z.enum(["none", "pending", "approved", "rejected", "suspended"]).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "users");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = await updateAdminUser(auth.admin, id, schema.parse(await request.json()));
  return NextResponse.json({ user });
}
