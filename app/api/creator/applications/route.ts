import { NextResponse } from "next/server";
import { z } from "zod";
import { createCreatorApplication } from "@/lib/db-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  userId: z.string().optional(),
  displayName: z.string().min(2),
  category: z.string().min(2),
  portfolio: z.string().min(3),
  contact: z.string().min(3),
  note: z.string().optional()
});

export async function POST(request: Request) {
  const application = await createCreatorApplication(schema.parse(await request.json()));
  return NextResponse.json({ application }, { status: 201 });
}
