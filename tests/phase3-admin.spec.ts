import { expect, test, type APIRequestContext } from "@playwright/test";
import { registerFan, signInAdmin, signInSupport } from "./auth-helpers";

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

test("phase 3 admin APIs reject requests without token", async ({ request }) => {
  const response = await request.get("/api/admin/overview");
  expect(response.status()).toBe(401);
});

test("phase 3 admin APIs enforce role sections", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Role enforcement requires the seeded admin accounts.");
  await signInSupport(request);
  const response = await request.get("/api/admin/payment-channels", { headers: { "x-admin-role": "super_admin" } });
  expect(response.status()).toBe(403);
});

test("phase 3 admin UI is reachable with an admin session", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Admin UI sessions require the seeded database.");
  await signInAdmin(page.request);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "站务后台" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByTestId("admin-pricing-panel")).toBeVisible();
});

test("phase 3 admin can review creator applications and write audit logs", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 3 admin APIs require the seeded database.");

  await registerFan(request, "phase3-applicant");
  const application = await request.post("/api/creator/applications", {
    data: {
      displayName: "Phase 3 Creator",
      category: "Cosplay",
      portfolio: "https://example.com/phase3",
      contact: "phase3@example.com",
      note: "Phase 3 admin review"
    }
  });
  expect(application.ok()).toBeTruthy();
  const applicationBody = await application.json();

  const review = await request.post(`/api/admin/creator-applications/${applicationBody.application.id}/review`, {
    headers: adminHeaders,
    data: { status: "approved" }
  });
  expect(review.ok()).toBeTruthy();
  const reviewBody = await review.json();
  expect(reviewBody.application.status).toBe("approved");

  const audit = await request.get("/api/admin/audit-logs", { headers: adminHeaders });
  const auditBody = await audit.json();
  expect(auditBody.logs.some((log: { action: string; targetId: string }) =>
    log.action === "admin.creator_application.approved" && log.targetId === applicationBody.application.id
  )).toBeTruthy();
});

test("phase 3 pricing versions and payment channels are configurable", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Phase 3 admin APIs require the seeded database.");

  const versions = await request.get("/api/admin/pricing/versions", { headers: adminHeaders });
  expect(versions.ok()).toBeTruthy();
  const versionsBody = await versions.json();
  const active = versionsBody.versions.find((version: { status: string }) => version.status === "active");
  expect(active).toBeTruthy();

  const draft = await request.post("/api/admin/pricing/versions", {
    headers: adminHeaders,
    data: { name: `Phase 3 draft ${Date.now()}`, copyFromVersionId: active.id }
  });
  expect(draft.ok()).toBeTruthy();
  const draftBody = await draft.json();
  expect(draftBody.version.status).toBe("draft");
  expect(draftBody.version.tiers.length).toBeGreaterThan(0);

  const publish = await request.post(`/api/admin/pricing/versions/${draftBody.version.id}/publish`, { headers: adminHeaders });
  expect(publish.ok()).toBeTruthy();
  const publishBody = await publish.json();
  expect(publishBody.version.status).toBe("active");

  const tiers = await request.get("/api/pricing/tiers?levelId=level-2&contentType=long_video&saleMode=long_video_single");
  const tiersBody = await tiers.json();
  expect(tiersBody.tiers.map((tier: { price: number }) => tier.price)).toEqual([50, 80, 120]);

  const channel = await request.patch("/api/admin/payment-channels/usdt", {
    headers: adminHeaders,
    data: { enabled: true, mode: "test", statusNote: "phase3_e2e_enabled" }
  });
  expect(channel.ok()).toBeTruthy();
  const channelBody = await channel.json();
  expect(channelBody.channel.enabled).toBe(true);
});
