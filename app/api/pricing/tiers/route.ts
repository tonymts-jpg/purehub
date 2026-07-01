import { NextResponse } from "next/server";
import { getPriceTiers } from "@/lib/db-repository";
import type { ContentType, SaleMode } from "@/lib/platform-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tiers = await getPriceTiers({
    levelId: url.searchParams.get("levelId") ?? undefined,
    contentType: (url.searchParams.get("contentType") ?? undefined) as ContentType | undefined,
    saleMode: (url.searchParams.get("saleMode") ?? undefined) as SaleMode | undefined
  });
  return NextResponse.json({ tiers });
}
