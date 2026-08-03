import { expect, test } from "@playwright/test";
import { encodeAccountCursor, parseAccountCursor } from "../lib/account/cursor";
import { prisma } from "../lib/prisma";
import { safeCallbackPath } from "../lib/safe-callback";

test("account cursors are opaque and scope-bound", () => {
  const encoded = encodeAccountCursor({
    scope: "history",
    occurredAt: "2026-07-30T00:00:00.000Z",
    id: "view-1",
  });

  expect(parseAccountCursor(encoded, "history").id).toBe("view-1");
  expect(() => parseAccountCursor(encoded, "likes")).toThrow(
    "Account cursor does not belong to this resource.",
  );
  expect(() => parseAccountCursor("not-a-cursor", "history")).toThrow(
    "Account cursor is invalid.",
  );
});

test("account persistence models are available", () => {
  expect(prisma.channelBookmark).toBeDefined();
  expect(prisma.postViewHistory).toBeDefined();
});

test("safe callbacks preserve only same-origin pathname and query", () => {
  expect(safeCallbackPath("/favorites?type=channels&from=search")).toBe(
    "/favorites?type=channels&from=search",
  );
  expect(safeCallbackPath("/admin/finance?tab=payouts", "/admin")).toBe(
    "/admin/finance?tab=payouts",
  );

  for (const value of [
    "//evil.example/steal",
    "/\\evil.example/steal",
    "\\\\evil.example\\steal",
    "https://evil.example/steal",
    "javascript:alert(1)",
    "/%5cevil.example/steal",
    "/%255cevil.example/steal",
    "/%2f%2fevil.example/steal",
    "/%",
    "",
  ]) {
    expect(safeCallbackPath(value), value).toBe("/");
    expect(safeCallbackPath(value, "/admin"), value).toBe("/admin");
  }
});
