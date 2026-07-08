import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createPricingVersion, listPricingVersions } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tierSchema = z.object({
  levelId: z.string(),
  contentType: z.enum(["photo_short", "long_video"]),
  saleMode: z.enum(["single_plus_subscription", "subscription_only", "long_video_single"]),
  price: z.number().int().nonnegative(),
  currency: z.string().default("CNY")
});

const schema = z.object({
  name: z.string().min(3),
  copyFromVersionId: z.string().optional(),
  tiers: z.array(tierSchema).optional()
});

export async function GET(request: Request) {
  const auth = requireAdmin(request, "pricing");
  if (!auth.ok) return auth.response;

  const versions = await listPricingVersions();
  return NextResponse.json({ versions });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request, "pricing");
  if (!auth.ok) return auth.response;

  const version = await createPricingVersion(auth.admin, schema.parse(await request.json()));
  return NextResponse.json({ version }, { status: 201 });
}
