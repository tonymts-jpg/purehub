import { NextResponse } from "next/server";
import {
  ADMIN_ROLE_LABELS,
  CONTENT_RULES,
  DEFAULT_USDT_CONFIG,
  PAYMENT_PROVIDERS,
  SUPPORTED_LOCALES
} from "@/lib/platform-config";

export function GET() {
  return NextResponse.json({
    locales: SUPPORTED_LOCALES,
    contentRules: CONTENT_RULES,
    paymentProviders: PAYMENT_PROVIDERS,
    usdtDefaults: DEFAULT_USDT_CONFIG,
    adminRoles: ADMIN_ROLE_LABELS
  });
}
