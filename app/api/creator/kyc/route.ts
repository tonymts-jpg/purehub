import { NextResponse } from "next/server";
import { z } from "zod";
import { getKycCase, submitKycCase } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";
const schema = z.object({ userId: z.string().default("c1"), legalName: z.string().min(2), countryCode: z.string().length(2), documentKeys: z.array(z.string().min(3)).min(1).max(5) });

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId") ?? "c1";
  return NextResponse.json({ case: await getKycCase(userId) });
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ case: await submitKycCase(schema.parse(await request.json())) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit KYC case." }, { status: 400 });
  }
}
