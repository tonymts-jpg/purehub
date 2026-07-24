import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { hasDatabase, signInAdmin } from "./auth-helpers";

async function requirePhase7(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Phase 7 channel mutations run once against the shared staging database.");
  test.skip(!(await hasDatabase(request)), "Phase 7 requires the seeded PostgreSQL database.");
}

test("phase 7 admin channel list includes representative seeded channels", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  await signInAdmin(request);

  const response = await request.get("/api/admin/channels");
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  const slugs = body.channels.map((channel: { slug: string }) => channel.slug);

  expect(slugs).toEqual(expect.arrayContaining(["purehub-official", "yuki-studio", "private-curators"]));
});
