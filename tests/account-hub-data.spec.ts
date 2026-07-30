import { expect, test } from "@playwright/test";
import { encodeAccountCursor, parseAccountCursor } from "../lib/account/cursor";
import { prisma } from "../lib/prisma";

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
