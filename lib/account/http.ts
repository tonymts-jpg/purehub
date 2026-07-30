import { NextResponse } from "next/server";
import { AccountRepositoryError, type AccountListInput } from "./repository";

export type FavoriteListInput = AccountListInput & {
  type: "posts" | "channels";
};

function strictQuery(
  request: Request,
  allowedFields: readonly string[]
): URLSearchParams {
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(allowedFields);
  for (const field of searchParams.keys()) {
    if (!allowed.has(field)) {
      throw new TypeError(`This request does not accept the ${field} query parameter.`);
    }
    if (searchParams.getAll(field).length > 1) {
      throw new TypeError(`The ${field} query parameter may be provided at most once.`);
    }
  }
  return searchParams;
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new TypeError("Limit must be an integer between 1 and 50.");
  }
  const limit = Number(value);
  if (limit < 1 || limit > 50) {
    throw new TypeError("Limit must be an integer between 1 and 50.");
  }
  return limit;
}

export function favoriteListInput(request: Request): FavoriteListInput {
  const searchParams = strictQuery(request, ["type", "cursor", "limit"]);
  const type = searchParams.get("type");
  if (type !== "posts" && type !== "channels") {
    throw new TypeError("Favorite type must be posts or channels.");
  }
  const cursor = searchParams.get("cursor");
  if (cursor !== null && cursor.length === 0) {
    throw new TypeError("Account cursor is invalid.");
  }
  const limit = parseLimit(searchParams.get("limit"));
  return {
    type,
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

export function requireEmptyAccountQuery(request: Request): void {
  strictQuery(request, []);
}

export async function requireEmptyAccountMutation(request: Request): Promise<void> {
  if (request.body === null) return;
  const body = await request.text();
  if (body.length === 0) return;

  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new TypeError("Request body must be valid JSON.");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Request body must be an object.");
  }
  const field = Object.keys(input)[0];
  if (field) throw new TypeError(`This mutation does not accept ${field}.`);
}

export function accountRouteError(error: unknown): NextResponse {
  if (error instanceof AccountRepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TypeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  throw error;
}
