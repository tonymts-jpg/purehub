import { expect, test, type APIRequestContext } from "@playwright/test";
import { signInCreator, signInFan, signInSupport } from "./auth-helpers";

const adminHeaders = {
  "x-admin-token": process.env.ADMIN_ACCESS_TOKEN ?? "purehub-admin-demo-token",
  "x-admin-role": "super_admin"
};

async function hasDatabase(request: APIRequestContext) {
  try {
    const health = await request.get("/api/health");
    if (!health.ok()) return false;
    const body = await health.json();
    return body.dependencies.database.status === "ok";
  } catch {
    return false;
  }
}

async function createPaidPost(request: APIRequestContext, price: number) {
  await signInCreator(request);
  const post = await request.post("/api/posts", {
    data: {
      title: `Phase 4 paid post ${Date.now()}`,
      excerpt: "Phase 4 payment test post.",
      content: "This post is created by the Phase 4 payment test.",
      category: "Cosplay",
      contentType: "long_video",
      saleMode: "long_video_single",
      visibility: "purchase",
      price
    }
  });
  expect(post.ok()).toBeTruthy();
  return (await post.json()).post as { id: string };
}

async function activateFee(request: APIRequestContext, feeBps: number) {
  const created = await request.post("/api/admin/finance/fee-configs", {
    headers: adminHeaders,
    data: { name: `Phase 4 fee ${feeBps} ${Date.now()}`, feeBps }
  });
  expect(created.ok()).toBeTruthy();
  const createdBody = await created.json();

  const activated = await request.post(`/api/admin/finance/fee-configs/${createdBody.config.id}/activate`, {
    headers: adminHeaders
  });
  expect(activated.ok()).toBeTruthy();
  return (await activated.json()).config as { id: string; feeBps: number; status: string };
}

async function payOrder(request: APIRequestContext, itemId: string, kind: "post_unlock" | "subscription" = "post_unlock") {
  await signInFan(request);
  const order = await request.post("/api/payments/orders", {
    data: { kind, itemId }
  });
  expect(order.ok()).toBeTruthy();
  const orderBody = await order.json();

  const intent = await request.post("/api/payments/intents", {
    data: { orderId: orderBody.order.id, provider: "card" }
  });
  expect(intent.ok()).toBeTruthy();
  const intentBody = await intent.json();

  const confirm = await request.post(`/api/payments/intents/${intentBody.intent.id}/confirm`, {
    data: { source: "phase4_e2e" }
  });
  expect(confirm.ok()).toBeTruthy();

  const read = await request.get(`/api/payments/orders/${orderBody.order.id}`);
  expect(read.ok()).toBeTruthy();
  return (await read.json()).order;
}

test("phase 4 payment channel must be enabled before creating an intent", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 4 payment APIs require the seeded database.");

  const post = await createPaidPost(request, 100);
  await signInFan(request);
  const order = await request.post("/api/payments/orders", {
    data: { kind: "post_unlock", itemId: post.id }
  });
  expect(order.ok()).toBeTruthy();
  const orderBody = await order.json();

  await request.patch("/api/admin/payment-channels/paypal", {
    headers: adminHeaders,
    data: { enabled: false, mode: "test", statusNote: "phase4_disabled_check" }
  });

  const intent = await request.post("/api/payments/intents", {
    data: { orderId: orderBody.order.id, provider: "paypal" }
  });
  expect(intent.status()).toBe(400);
});

test("phase 4 configurable fees snapshot creator net revenue", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 4 payment APIs require the seeded database.");

  await request.patch("/api/admin/payment-channels/card", {
    headers: adminHeaders,
    data: { enabled: true, mode: "test", statusNote: "phase4_manual_confirm", config: { adapter: "manual_confirm" } }
  });

  const tenPercent = await activateFee(request, 1000);
  expect(tenPercent.status).toBe("active");

  const post100 = await createPaidPost(request, 100);
  const paid100 = await payOrder(request, post100.id);
  expect(paid100.status).toBe("fulfilled");
  expect(paid100.paymentTransactions[0].platformFeeBps).toBe(1000);
  expect(paid100.paymentTransactions[0].platformFeeAmount).toBe(10);
  expect(paid100.paymentTransactions[0].creatorNetAmount).toBe(90);
  expect(paid100.entitlements.length).toBe(1);

  const fifteenPercent = await activateFee(request, 1500);
  expect(fifteenPercent.status).toBe("active");

  const post200 = await createPaidPost(request, 100);
  const paid200 = await payOrder(request, post200.id);
  expect(paid200.paymentTransactions[0].platformFeeBps).toBe(1500);
  expect(paid200.paymentTransactions[0].platformFeeAmount).toBe(15);
  expect(paid200.paymentTransactions[0].creatorNetAmount).toBe(85);

  const rereadOld = await request.get(`/api/payments/orders/${paid100.id}`);
  const rereadOldBody = await rereadOld.json();
  expect(rereadOldBody.order.paymentTransactions[0].platformFeeBps).toBe(1000);
});

test("phase 4 manual confirmation is idempotent and subscriptions fulfill", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 4 payment APIs require the seeded database.");

  await request.patch("/api/admin/payment-channels/card", {
    headers: adminHeaders,
    data: { enabled: true, mode: "test", statusNote: "phase4_manual_confirm", config: { adapter: "manual_confirm" } }
  });
  await activateFee(request, 1000);

  await signInFan(request);
  const order = await request.post("/api/payments/orders", {
    data: { kind: "subscription", itemId: "p12" }
  });
  expect(order.ok()).toBeTruthy();
  const orderBody = await order.json();

  const intent = await request.post("/api/payments/intents", {
    data: { orderId: orderBody.order.id, provider: "card" }
  });
  const intentBody = await intent.json();

  await request.post(`/api/payments/intents/${intentBody.intent.id}/confirm`, { data: { first: true } });
  await request.post(`/api/payments/intents/${intentBody.intent.id}/confirm`, { data: { second: true } });

  const read = await request.get(`/api/payments/orders/${orderBody.order.id}`);
  const body = await read.json();
  expect(body.order.status).toBe("fulfilled");
  expect(body.order.subscriptions.length).toBe(1);
  expect(body.order.paymentTransactions.length).toBe(1);
});

test("phase 4 finance admin can review payouts and support admin cannot", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 4 payout APIs require the seeded database.");

  await signInCreator(request);
  const payout = await request.post("/api/payout-requests", {
    data: { amount: 100, channel: "alipay" }
  });
  expect(payout.ok()).toBeTruthy();
  const payoutBody = await payout.json();

  await signInSupport(request);
  const forbidden = await request.patch("/api/admin/finance/payout-requests", {
    headers: { "x-admin-role": "super_admin" },
    data: { id: payoutBody.payout.id, status: "approved" }
  });
  expect(forbidden.status()).toBe(403);

  const approved = await request.patch("/api/admin/finance/payout-requests", {
    headers: adminHeaders,
    data: { id: payoutBody.payout.id, status: "approved", reviewNote: "phase4_e2e_approved" }
  });
  expect(approved.ok()).toBeTruthy();
  const approvedBody = await approved.json();
  expect(approvedBody.payout.status).toBe("approved");
});
