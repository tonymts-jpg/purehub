import { expect, test } from "@playwright/test";

test("health endpoint exposes server dependency status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.locales).toEqual(["zh-CN", "zh-TW", "en", "ja"]);
  expect(body.paymentProviders).toContain("usdt");
  expect(body.dependencies.database.status).toMatch(/ok|skipped/);
  expect(body.dependencies.redis.status).toMatch(/ok|skipped/);
  expect(body.dependencies.objectStorage.status).toMatch(/ok|skipped/);
});

test("platform rules expose formal phase constraints", async ({ request }) => {
  const response = await request.get("/api/platform/rules");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.contentRules.shortVideoMaxSeconds).toBe(60);
  expect(body.contentRules.longVideoMaxSeconds).toBe(300);
  expect(body.usdtDefaults.networks).toEqual(["TRC20", "ERC20"]);
  expect(body.platformFeeRules).toEqual({ minFeeBps: 0, maxFeeBps: 5000, defaultFeeBps: 1000 });
  expect(body.settlementRules).toEqual({ defaultHoldDays: 7, minHoldDays: 0, maxHoldDays: 90 });
  expect(Object.keys(body.paymentProviders)).toEqual([
    "stripe",
    "paypal",
    "card",
    "alipay_intl",
    "wechatpay_intl",
    "usdt"
  ]);
});
