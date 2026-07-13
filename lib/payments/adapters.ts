import type { PaymentProvider } from "@/lib/platform-config";

type PaymentChannel = {
  provider: string;
  mode: string;
  config: unknown;
};

type AdapterOrder = {
  id: string;
  amount: number;
  currency: string;
};

type AdapterIntent = {
  id: string;
  provider: string;
  amount: number;
  currency: string;
};

export type PaymentAdapter = {
  provider: PaymentProvider | "manual_confirm";
  supportsManualConfirmation: boolean;
  createIntent: (order: AdapterOrder, channel: PaymentChannel) => {
    providerIntentId: string;
    clientSecret?: string;
    manualInstructions?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  confirmIntent: (intent: AdapterIntent, payload?: unknown) => {
    status: "succeeded" | "failed" | "processing";
    metadata?: Record<string, unknown>;
  };
  parseWebhook: (payload: unknown) => {
    providerEventId: string;
    eventType: string;
    intentId?: string;
    status: "succeeded" | "failed" | "processing";
  };
};

const sandboxAdapter = (provider: PaymentProvider): PaymentAdapter => ({
  provider,
  supportsManualConfirmation: false,
  createIntent: (order, channel) => ({
    providerIntentId: `${provider}_${order.id}`,
    clientSecret: channel.mode === "test" ? `${provider}_sandbox_${order.id}` : undefined,
    metadata: { sandbox: true, provider }
  }),
  confirmIntent: () => ({ status: "processing", metadata: { sandbox: true } }),
  parseWebhook: (payload) => {
    const body = payload as { id?: string; type?: string; intentId?: string; status?: "succeeded" | "failed" | "processing" };
    return {
      providerEventId: body.id ?? `evt_${Date.now()}`,
      eventType: body.type ?? "payment_intent.updated",
      intentId: body.intentId,
      status: body.status ?? "processing"
    };
  }
});

export const manualConfirmAdapter: PaymentAdapter = {
  provider: "manual_confirm",
  supportsManualConfirmation: true,
  createIntent: (order, channel) => ({
    providerIntentId: `manual_${order.id}`,
    manualInstructions: {
      message: "Manual confirmation is enabled for Phase 4 sandbox payments.",
      provider: channel.provider,
      amount: order.amount,
      currency: order.currency
    },
    metadata: { adapter: "manual_confirm" }
  }),
  confirmIntent: (_intent, payload) => ({
    status: "succeeded",
    metadata: { adapter: "manual_confirm", payload: payload ?? null }
  }),
  parseWebhook: (payload) => {
    const body = payload as { id?: string; type?: string; intentId?: string; status?: "succeeded" | "failed" | "processing" };
    return {
      providerEventId: body.id ?? `manual_evt_${Date.now()}`,
      eventType: body.type ?? "manual.payment_confirmed",
      intentId: body.intentId,
      status: body.status ?? "succeeded"
    };
  }
};

export function resolvePaymentAdapter(provider: PaymentProvider, channelConfig?: unknown): PaymentAdapter {
  const config = channelConfig as { adapter?: string } | null;
  if (config?.adapter === "manual_confirm" || provider === "card") return manualConfirmAdapter;
  return sandboxAdapter(provider);
}
