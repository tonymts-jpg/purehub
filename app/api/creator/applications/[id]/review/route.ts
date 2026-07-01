import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewCreatorApplication } from "@/lib/db-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ status: z.enum(["approved", "rejected"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = schema.parse(await request.json());
  const application = await reviewCreatorApplication(id, body.status);
  return NextResponse.json({ application });
}
