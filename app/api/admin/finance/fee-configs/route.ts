import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createPlatformFeeConfig, listPlatformFeeConfigs } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(1),
  feeBps: z.number().int().min(0).max(5000)
});

export async function GET(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  const configs = await listPlatformFeeConfigs();
  return NextResponse.json({ configs });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request, "transactions");
  if (!auth.ok) return auth.response;
  try {
    const config = await createPlatformFeeConfig(auth.admin, schema.parse(await request.json()));
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create fee config." }, { status: 400 });
  }
}
