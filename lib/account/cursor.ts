import type { AccountCursor, AccountListScope } from "./types";

const accountListScopes: ReadonlySet<AccountListScope> = new Set([
  "favorite-posts",
  "favorite-channels",
  "unlocked",
  "likes",
  "history",
  "orders",
  "following",
]);

export function encodeAccountCursor(cursor: AccountCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function parseAccountCursor(
  value: string,
  scope: AccountListScope,
): AccountCursor {
  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Account cursor is invalid.");
  }

  if (!isAccountCursor(decoded)) {
    throw new Error("Account cursor is invalid.");
  }

  if (decoded.scope !== scope) {
    throw new Error("Account cursor does not belong to this resource.");
  }

  return decoded;
}

function isAccountCursor(value: unknown): value is AccountCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const cursor = value as Record<string, unknown>;
  return (
    typeof cursor.scope === "string" &&
    accountListScopes.has(cursor.scope as AccountListScope) &&
    typeof cursor.occurredAt === "string" &&
    isValidIsoTimestamp(cursor.occurredAt) &&
    typeof cursor.id === "string" &&
    cursor.id.length > 0
  );
}

function isValidIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
