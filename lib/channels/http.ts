import { NextResponse } from "next/server";
import { ChannelMembershipError } from "./membership";
import { ChannelRepositoryError } from "./repository";
import type { ListChannelsInput } from "./types";

export async function readChannelJson(request: Request, optional = false): Promise<unknown> {
  if (request.body === null) {
    if (optional) return {};
    throw new TypeError("Request body must be valid JSON.");
  }
  const body = await request.text();
  if (body.length === 0) {
    if (optional) return {};
    throw new TypeError("Request body must be valid JSON.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TypeError("Request body must be valid JSON.");
  }
}

export function requireEmptyChannelMutation(input: unknown): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Request body must be an object.");
  }
  const fields = Object.keys(input);
  if (fields.length) throw new TypeError(`This mutation does not accept ${fields[0]}.`);
}

export function requireEmptyChannelQuery(
  searchParams: URLSearchParams,
  allowed: readonly string[] = []
): void {
  const allowedFields = new Set(allowed);
  const field = Array.from(searchParams.keys()).find((candidate) => !allowedFields.has(candidate));
  if (field) throw new TypeError(`This request does not accept the ${field} query parameter.`);
}

export function channelListInput(request: Request): ListChannelsInput {
  const searchParams = new URL(request.url).searchParams;
  const cursor = searchParams.get("cursor");
  const kind = searchParams.get("kind");
  const visibility = searchParams.get("visibility");
  const status = searchParams.get("status");
  const limit = searchParams.get("limit");
  return {
    ...(cursor ? { cursor } : {}),
    ...(kind ? { kind: kind as ListChannelsInput["kind"] } : {}),
    ...(visibility ? { visibility: visibility as ListChannelsInput["visibility"] } : {}),
    ...(status ? { status: status as ListChannelsInput["status"] } : {}),
    ...(limit !== null ? { limit: Number(limit) } : {})
  };
}

export function channelRouteError(error: unknown): NextResponse {
  if (error instanceof ChannelRepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ChannelMembershipError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TypeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  throw error;
}
