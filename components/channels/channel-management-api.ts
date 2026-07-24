export class ChannelUiApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChannelUiApiError";
    this.status = status;
  }
}

export async function channelApi<T>(
  url: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ChannelUiApiError(
      typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`,
      response.status
    );
  }
  return body as T;
}

export function channelErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function pageUrl(base: string, cursor: string | null, limit: number) {
  const url = new URL(base, window.location.origin);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  else url.searchParams.delete("cursor");
  return `${url.pathname}${url.search}`;
}

export async function loadEveryChannelPage<T extends { id?: string; slug?: string }>(
  baseUrl: string,
  key: string,
  signal: AbortSignal,
  limit = 50
): Promise<{ items: T[]; firstBody: Record<string, unknown> }> {
  const items: T[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let firstBody: Record<string, unknown> = {};

  for (let page = 0; page < 100; page += 1) {
    const body: Record<string, unknown> = await channelApi<Record<string, unknown>>(
      pageUrl(baseUrl, cursor, limit),
      undefined,
      signal
    );
    if (page === 0) firstBody = body;
    const rows = Array.isArray(body[key]) ? body[key] as T[] : [];
    for (const row of rows) {
      const identity = row.id ?? row.slug;
      if (!identity || identities.has(identity)) continue;
      identities.add(identity);
      items.push(row);
    }
    const nextCursor: string | null =
      typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
    if (!nextCursor) return { items, firstBody };
    if (cursors.has(nextCursor)) throw new Error("频道分页游标重复，已停止载入。");
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("频道分页超过安全上限。");
}
