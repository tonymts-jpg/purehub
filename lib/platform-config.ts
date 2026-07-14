export type Locale = "zh-CN" | "zh-TW" | "en" | "ja";
export type UserRole = "fan" | "creator" | "admin";
export type CreatorStatus = "none" | "pending" | "approved" | "rejected" | "suspended";
export type ContentType = "photo_short" | "long_video";
export type SaleMode = "single_plus_subscription" | "subscription_only" | "long_video_single";
export type PaymentProvider = "stripe" | "paypal" | "card" | "alipay_intl" | "wechatpay_intl" | "usdt";
export type AdminRole =
  | "super_admin"
  | "ops_admin"
  | "content_admin"
  | "finance_admin"
  | "support_admin"
  | "analyst";

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "zh-TW", "en", "ja"];

export const CONTENT_RULES = {
  shortVideoMaxSeconds: 60,
  longVideoMinSecondsExclusive: 60,
  longVideoMaxSeconds: 300
} as const;

export const PAYMENT_PROVIDERS: Record<PaymentProvider, { label: string; configurable: true }> = {
  stripe: { label: "Stripe", configurable: true },
  paypal: { label: "PayPal", configurable: true },
  card: { label: "Credit Card", configurable: true },
  alipay_intl: { label: "Alipay International", configurable: true },
  wechatpay_intl: { label: "WeChat Pay International", configurable: true },
  usdt: { label: "USDT", configurable: true }
};

export const DEFAULT_USDT_CONFIG = {
  networks: ["TRC20", "ERC20"],
  minConfirmations: 12,
  orderTtlMinutes: 30,
  rateSource: "admin_fixed_rate"
} as const;

export const PLATFORM_FEE_RULES = {
  minFeeBps: 0,
  maxFeeBps: 5000,
  defaultFeeBps: 1000
} as const;

export const SETTLEMENT_RULES = {
  defaultHoldDays: 7,
  minHoldDays: 0,
  maxHoldDays: 90
} as const;

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  ops_admin: "Operations Admin",
  content_admin: "Content Admin",
  finance_admin: "Finance Admin",
  support_admin: "Support Admin",
  analyst: "Data Analyst"
};

export function classifyMediaByDuration(seconds: number): ContentType {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Video duration must be a non-negative number.");
  }
  if (seconds <= CONTENT_RULES.shortVideoMaxSeconds) return "photo_short";
  if (seconds <= CONTENT_RULES.longVideoMaxSeconds) return "long_video";
  throw new Error("Video duration exceeds the 300 second long-video limit.");
}

export function isSaleModeAllowed(contentType: ContentType, saleMode: SaleMode): boolean {
  if (saleMode === "long_video_single") return contentType === "long_video";
  return saleMode === "single_plus_subscription" || saleMode === "subscription_only";
}
