import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { listKycCases, reviewKycCase } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";
const schema = z.object({ id: z.string(), status: z.enum(["approved", "rejected"]), reviewNote: z.string().max(500).optional() });

export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ cases: await listKycCases() });
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ case: await reviewKycCase(auth.admin, schema.parse(await request.json())) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review KYC case." }, { status: 400 });
  }
}
