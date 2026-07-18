import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { updatePaymentChannel } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["test", "live"]).optional(),
  currencies: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  feeNote: z.string().optional(),
  statusNote: z.string().optional(),
  config: z.unknown().optional()
});

const providers = ["stripe", "paypal", "card", "alipay_intl", "wechatpay_intl", "usdt"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const auth = await requireAdmin(request, "payments");
  if (!auth.ok) return auth.response;

  const { provider } = await params;
  if (!providers.includes(provider as typeof providers[number])) {
    return NextResponse.json({ error: "Unknown payment provider." }, { status: 404 });
  }

  const channel = await updatePaymentChannel(auth.admin, provider as typeof providers[number], schema.parse(await request.json()));
  return NextResponse.json({ channel });
}
