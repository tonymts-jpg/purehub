import { NextResponse } from "next/server";
import { z } from "zod";
import { getKycCase, submitKycCase } from "@/lib/finance/ledger";
import { enforceSameOrigin, requireCreator } from "@/lib/session";

export const dynamic = "force-dynamic";
const schema = z.object({ legalName: z.string().min(2), countryCode: z.string().length(2), documentKeys: z.array(z.string().min(3)).min(1).max(5) });

export async function GET(request: Request) {
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  return NextResponse.json({ case: await getKycCase(session.user.id) });
}

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireCreator(request);
  if (!session.ok) return session.response;
  try {
    return NextResponse.json({ case: await submitKycCase({ ...schema.parse(await request.json()), userId: session.user.id }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit KYC case." }, { status: 400 });
  }
}
