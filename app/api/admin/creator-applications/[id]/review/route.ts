import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { reviewApplicationFromAdmin } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ status: z.enum(["approved", "rejected"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request, "applications");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = schema.parse(await request.json());
  const application = await reviewApplicationFromAdmin(auth.admin, id, body.status);
  return NextResponse.json({ application });
}
