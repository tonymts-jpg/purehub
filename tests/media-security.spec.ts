import { expect, test, type TestInfo } from "@playwright/test";
import { acceptsUploadMediaType, normalizeByteRange, resolveStaticMediaRedirect } from "../lib/storage/media-policy";
import { prisma } from "../lib/prisma";
import { authHeaders, hasDatabase, signInCreator } from "./auth-helpers";

test("media MIME policy rejects active content and kind mismatches", () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]) {
    expect(acceptsUploadMediaType({ kind: "image", mimeType })).toBe(true);
  }
  for (const mimeType of ["video/mp4", "video/webm"]) {
    expect(acceptsUploadMediaType({ kind: "video", mimeType })).toBe(true);
  }

  for (const input of [
    { kind: "image" as const, mimeType: "image/svg+xml" },
    { kind: "image" as const, mimeType: "text/html" },
    { kind: "video" as const, mimeType: "image/svg+xml" },
    { kind: "video" as const, mimeType: "image/png" },
    { kind: "image" as const, mimeType: "video/mp4" },
    { kind: "video" as const, mimeType: "application/xml" },
    { kind: "video" as const, mimeType: "video/mp4; charset=utf-8" }
  ]) {
    expect(acceptsUploadMediaType(input)).toBe(false);
  }
});

test("static media redirect policy permits only passive same-origin generated assets", () => {
  const requestUrl = "https://purehub.example/api/media/asset/content";
  expect(resolveStaticMediaRedirect("/generated/posts/post-1/01.webp", requestUrl).href)
    .toBe("https://purehub.example/generated/posts/post-1/01.webp");

  for (const src of [
    "https://evil.example/payload.svg",
    "//evil.example/payload.svg",
    "/\\evil.example/payload.svg",
    "/%5c%5cevil.example/payload.svg",
    "/generated/%255c%255cevil.example/payload.webp",
    "/api/media/asset/access",
    "/api/health",
    "/generated/../api/health",
    "/generated/%2e%2e/api/health",
    "/generated/payload.svg",
    "/generated/payload.html",
    "/generated/posts/post-1/01.webp?redirect=https://evil.example"
  ]) {
    expect(() => resolveStaticMediaRedirect(src, requestUrl)).toThrow();
  }
});

test("byte range policy normalizes valid ranges and rejects unsatisfiable requests", () => {
  expect(normalizeByteRange("bytes=2-6", 16)).toBe("bytes=2-6");
  expect(normalizeByteRange("bytes=4-", 16)).toBe("bytes=4-");
  expect(normalizeByteRange("bytes=-5", 16)).toBe("bytes=-5");

  for (const range of [
    "items=0-1",
    "bytes=",
    "bytes=4-2",
    "bytes=16-20",
    "bytes=-0",
    "bytes=0-1,4-5"
  ]) {
    expect(() => normalizeByteRange(range, 16)).toThrow();
  }
});

test("upload API rejects SVG and MIME-kind mismatch before creating an asset", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared storage mutation runs once.");
  test.skip(!(await hasDatabase(request)), "Upload boundary integration requires PostgreSQL.");
  await signInCreator(request);

  for (const input of [
    { fileName: "active.svg", mimeType: "image/svg+xml", sizeBytes: 100, kind: "image", visibility: "public" },
    { fileName: "active-as-video.svg", mimeType: "image/svg+xml", sizeBytes: 100, kind: "video", visibility: "public" },
    { fileName: "mismatch.png", mimeType: "image/png", sizeBytes: 100, kind: "video", visibility: "public" },
    { fileName: "mismatch.mp4", mimeType: "video/mp4", sizeBytes: 100, kind: "image", visibility: "public" }
  ]) {
    const response = await request.post("/api/uploads/presign", { headers: authHeaders, data: input });
    expect(response.status(), await response.text()).toBe(400);
  }
});

test("media content route rejects legacy cross-origin and internal redirects", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared database fixture runs once.");
  test.skip(!(await hasDatabase(request)), "Legacy media redirect integration requires PostgreSQL.");
  const nonce = Date.now().toString(36);
  const fixtures = [
    { id: `media-redirect-authority-${nonce}`, src: "/\\evil.example/payload.webp" },
    { id: `media-redirect-internal-${nonce}`, src: "/api/health" }
  ];

  try {
    await prisma.mediaAsset.createMany({
      data: fixtures.map((fixture, order) => ({
        ...fixture,
        postId: "post-1",
        alt: "Rejected legacy redirect",
        width: 720,
        height: 900,
        order: 100 + order,
        kind: "image",
        mimeType: "image/webp",
        status: "ready",
        visibility: "public"
      }))
    });
    for (const fixture of fixtures) {
      const response = await request.get(`/api/media/${fixture.id}/content`, { maxRedirects: 0 });
      expect(response.status(), await response.text()).toBe(404);
      expect(response.headers()["location"]).toBeUndefined();
    }
  } finally {
    await prisma.mediaAsset.deleteMany({ where: { id: { in: fixtures.map(({ id }) => id) } } }).catch(() => undefined);
  }
});
