import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";

const adminHeaders = {
  "x-admin-token": process.env.ADMIN_ACCESS_TOKEN ?? "purehub-admin-demo-token",
  "x-admin-role": "finance_admin"
};
const supportHeaders = { ...adminHeaders, "x-admin-role": "support_admin" };

async function requireDatabase(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Phase 5 finance mutations run once against the shared staging database.");
  const health = await request.get("/api/health");
  test.skip(!health.ok() || (await health.json()).dependencies.database.status !== "ok", "Phase 5 requires PostgreSQL.");
}

async function enableCard(request: APIRequestContext) {
  const response = await request.patch("/api/admin/payment-channels/card", {
    headers: adminHeaders,
    data: { enabled: true, mode: "test", statusNote: "phase5_manual_confirm", config: { adapter: "manual_confirm" } }
  });
  expect(response.ok()).toBeTruthy();
}

async function activateSettlement(request: APIRequestContext, holdDays: number) {
  const created = await request.post("/api/admin/finance/settlement-configs", { headers: adminHeaders, data: { name: `Phase 5 ${holdDays} day ${Date.now()}`, holdDays } });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const activated = await request.post(`/api/admin/finance/settlement-configs/${body.config.id}/activate`, { headers: adminHeaders });
  expect(activated.ok()).toBeTruthy();
}

async function createPost(request: APIRequestContext, mediaAssetIds?: string[]) {
  const response = await request.post("/api/posts", {
    data: {
      creatorId: "c1",
      title: `Phase 5 paid post ${Date.now()} ${Math.random()}`,
      excerpt: "Phase 5 commercial readiness test post.",
      content: "This paid post verifies ledger, refunds, settlement, and private media access.",
      category: "Cosplay",
      contentType: "long_video",
      saleMode: "long_video_single",
      visibility: "purchase",
      price: 100,
      mediaAssetIds
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).post as { id: string };
}

async function pay(request: APIRequestContext, itemId: string) {
  await enableCard(request);
  const created = await request.post("/api/payments/orders", { data: { buyerUserId: "fan-demo", kind: "post_unlock", itemId } });
  expect(created.ok()).toBeTruthy();
  const order = (await created.json()).order;
  const intentResponse = await request.post("/api/payments/intents", { data: { orderId: order.id, provider: "card" } });
  expect(intentResponse.ok()).toBeTruthy();
  const intent = (await intentResponse.json()).intent;
  const confirmed = await request.post(`/api/payments/intents/${intent.id}/confirm`, { data: { source: "phase5_e2e" } });
  expect(confirmed.ok()).toBeTruthy();
  const read = await request.get(`/api/payments/orders/${order.id}`);
  return (await read.json()).order;
}

test("phase 5 payment ledger is balanced and revenue starts pending", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  await activateSettlement(request, 7);
  const paid = await pay(request, (await createPost(request)).id);
  expect(paid.paymentTransactions[0].availableAt).toBeTruthy();
  expect(new Date(paid.paymentTransactions[0].availableAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

  const ledger = await request.get(`/api/admin/finance/ledger?referenceId=${paid.id}`, { headers: adminHeaders });
  expect(ledger.ok()).toBeTruthy();
  const payment = (await ledger.json()).transactions.find((item: { type: string }) => item.type === "payment_capture");
  expect(payment.entries.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0)).toBe(0);
});

test("phase 5 settlement is idempotent", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  await activateSettlement(request, 0);
  const paid = await pay(request, (await createPost(request)).id);
  const paymentId = paid.paymentTransactions[0].id;
  await request.post("/api/admin/finance/settlements/run", { headers: adminHeaders });
  await request.post("/api/admin/finance/settlements/run", { headers: adminHeaders });
  const reread = await request.get(`/api/payments/orders/${paid.id}`);
  const order = (await reread.json()).order;
  expect(order.paymentTransactions[0].settledAt).toBeTruthy();
  const ledger = await request.get(`/api/admin/finance/ledger?referenceId=${paymentId}`, { headers: adminHeaders });
  const settlements = (await ledger.json()).transactions.filter((item: { type: string }) => item.type === "creator_settlement");
  expect(settlements).toHaveLength(1);
  expect(settlements[0].entries.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0)).toBe(0);
});

test("phase 5 full refund is idempotent and revokes access", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  await activateSettlement(request, 7);
  const paid = await pay(request, (await createPost(request)).id);
  const first = await request.post(`/api/admin/finance/orders/${paid.id}/refund`, { headers: adminHeaders, data: { reason: "Phase 5 refund test" } });
  const second = await request.post(`/api/admin/finance/orders/${paid.id}/refund`, { headers: adminHeaders, data: { reason: "Repeated refund" } });
  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();
  const read = await request.get(`/api/payments/orders/${paid.id}`);
  const order = (await read.json()).order;
  expect(order.status).toBe("refunded");
  expect(order.entitlements).toHaveLength(0);
  const ledger = await request.get(`/api/admin/finance/ledger?referenceId=${paid.id}`, { headers: adminHeaders });
  expect((await ledger.json()).transactions.filter((item: { type: string }) => item.type === "refund")).toHaveLength(1);

  const charged = await pay(request, (await createPost(request)).id);
  const event = { id: `phase5-chargeback-${Date.now()}`, type: "chargeback.created", intentId: charged.paymentIntents[0].id, status: "charged_back" };
  expect((await request.post("/api/payments/webhooks/card", { data: event })).ok()).toBeTruthy();
  expect((await request.post("/api/payments/webhooks/card", { data: event })).ok()).toBeTruthy();
  const chargedOrder = await (await request.get(`/api/payments/orders/${charged.id}`)).json();
  expect(chargedOrder.order.status).toBe("charged_back");
  const chargedLedger = await request.get(`/api/admin/finance/ledger?referenceId=${charged.id}`, { headers: adminHeaders });
  expect((await chargedLedger.json()).transactions.filter((item: { type: string }) => item.type === "chargeback")).toHaveLength(1);
});

test("phase 5 payout moves available through reserved to clearing", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const before = await request.get("/api/dashboard/summary?creatorId=c1");
  const beforeWallet = await before.json();
  const created = await request.post("/api/payout-requests", { data: { userId: "c1", amount: 100, channel: "alipay" } });
  expect(created.ok()).toBeTruthy();
  const payout = (await created.json()).payout;
  const reserved = await (await request.get("/api/dashboard/summary?creatorId=c1")).json();
  expect(reserved.balance).toBe(beforeWallet.balance - 100);
  expect(reserved.reserved).toBe(beforeWallet.reserved + 100);
  expect((await request.patch("/api/admin/finance/payout-requests", { headers: adminHeaders, data: { id: payout.id, status: "approved" } })).ok()).toBeTruthy();
  expect((await request.patch("/api/admin/finance/payout-requests", { headers: adminHeaders, data: { id: payout.id, status: "paid" } })).ok()).toBeTruthy();
  const paid = await (await request.get("/api/dashboard/summary?creatorId=c1")).json();
  expect(paid.reserved).toBe(beforeWallet.reserved);
});

test("phase 5 KYC, private media access, and reconciliation enforce finance boundaries", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const submitted = await request.post("/api/creator/kyc", { data: { userId: "c2", legalName: "Phase Five Creator", countryCode: "CN", documentKeys: ["kyc/c2/phase5-test.enc"] } });
  expect(submitted.ok()).toBeTruthy();
  const forbidden = await request.get("/api/admin/finance/kyc-cases", { headers: supportHeaders });
  expect(forbidden.status()).toBe(403);
  const cases = await request.get("/api/admin/finance/kyc-cases", { headers: adminHeaders });
  const kyc = (await cases.json()).cases.find((item: { userId: string }) => item.userId === "c2");
  expect((await request.patch("/api/admin/finance/kyc-cases", { headers: adminHeaders, data: { id: kyc.id, status: "approved" } })).ok()).toBeTruthy();

  const prepared = await request.post("/api/uploads/presign", { data: { userId: "c1", fileName: "phase5-private.jpg", mimeType: "image/jpeg", sizeBytes: 100, kind: "image", visibility: "purchase" } });
  expect(prepared.ok()).toBeTruthy();
  const upload = await prepared.json();
  expect((await request.post("/api/uploads/complete", { data: { assetId: upload.assetId, userId: "c1", simulate: true, width: 100, height: 100 } })).ok()).toBeTruthy();
  const post = await createPost(request, [upload.assetId]);
  expect((await request.get(`/api/media/${upload.assetId}/access`)).status()).toBe(403);
  await activateSettlement(request, 7);
  await pay(request, post.id);
  expect((await request.get(`/api/media/${upload.assetId}/access?userId=fan-demo`)).ok()).toBeTruthy();

  const reconciliation = await request.post("/api/admin/finance/reconciliation", { headers: adminHeaders });
  expect(reconciliation.ok()).toBeTruthy();
  expect((await reconciliation.json()).run.status).toBe("completed");
});
