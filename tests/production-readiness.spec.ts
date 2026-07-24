import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("health endpoint exposes server dependency status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.phase).toBe("phase-7");
  expect(body.locales).toEqual(["zh-CN", "zh-TW", "en", "ja"]);
  expect(body.paymentProviders).toContain("usdt");
  expect(body.capabilities).toMatchObject({
    databaseSessions: true,
    credentialAuth: true,
    socialInteractions: true,
    notifications: true,
    channels: true,
    channelAcl: true,
    postgresSearch: true
  });
  expect(body.dependencies.database.status).toMatch(/ok|skipped/);
  expect(body.dependencies.redis.status).toMatch(/ok|skipped/);
  expect(body.dependencies.objectStorage.status).toMatch(/ok|skipped/);
});

test("phase 7 public smoke surfaces and identity boundary are ready", async ({ request }) => {
  const healthResponse = await request.get("/api/health");
  const healthBody = await healthResponse.json();
  test.skip(
    healthBody.dependencies?.database?.status !== "ok",
    "Phase 7 public smoke surfaces require the live PostgreSQL staging gate."
  );

  const channelsResponse = await request.get("/api/channels");
  expect(channelsResponse.ok(), await channelsResponse.text()).toBeTruthy();
  const channelsBody = await channelsResponse.json();
  expect(Array.isArray(channelsBody.channels)).toBeTruthy();

  const searchResponse = await request.get("/api/search?q=yuki&type=creator");
  expect(searchResponse.ok(), await searchResponse.text()).toBeTruthy();
  const searchBody = await searchResponse.json();
  expect(Array.isArray(searchBody.results)).toBeTruthy();

  const mutationResponse = await request.post("/api/dashboard/channels", {
    data: {
      name: "Unauthenticated smoke mutation",
      slug: "unauthenticated-smoke-mutation",
      visibility: "public"
    }
  });
  expect(mutationResponse.status(), await mutationResponse.text()).toBe(401);
});

test("deployment defaults and both smoke runners enforce the phase 7 contract", async () => {
  const [environment, compose, nodeSmoke, shellSmoke, worker] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("scripts/smoke-test.mjs", "utf8"),
    readFile("scripts/smoke-test.sh", "utf8"),
    readFile("scripts/worker.mjs", "utf8")
  ]);

  expect(environment).toMatch(/^PUREHUB_PHASE=phase-7$/m);
  expect(compose.match(/PUREHUB_PHASE: \$\{PUREHUB_PHASE:-phase-7\}/g)).toHaveLength(2);

  for (const smoke of [nodeSmoke, shellSmoke]) {
    expect(smoke).toContain("/api/channels");
    expect(smoke).toContain("/api/search?q=yuki&type=creator");
    expect(smoke).toContain("/api/dashboard/channels");
    expect(smoke).toContain("phase-7");
    expect(smoke).toContain("postgresSearch");
  }

  expect(worker).toContain('"channelMaterialization"');
  expect(worker).toContain('"searchIndexing"');
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
  expect(body.identity).toEqual({ provider: "better-auth", sessionStore: "database", credentials: true });
  expect(body.social).toEqual({ follows: true, likes: true, bookmarks: true, comments: true, notifications: true });
  expect(body.channels).toEqual({
    kinds: ["official", "creator"],
    visibilities: ["public", "private"],
    discoverability: ["discoverable", "hidden"],
    roles: ["owner", "editor", "member"],
    creatorLevelQuotas: { "level-1": 1, "level-2": 3, "level-3": 5 }
  });
  expect(Object.keys(body.paymentProviders)).toEqual([
    "stripe",
    "paypal",
    "card",
    "alipay_intl",
    "wechatpay_intl",
    "usdt"
  ]);
});
