import { getRedisClient } from "@/lib/redis";

const globalForRateLimit = globalThis as unknown as {
  purehubMemoryLimits?: Map<string, { count: number; resetAt: number }>;
};

function memoryHit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const store = globalForRateLimit.purehubMemoryLimits ?? new Map();
  globalForRateLimit.purehubMemoryLimits = store;
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export async function consumeRateLimit(scope: string, subject: string, limit: number, windowSeconds: number) {
  const key = `purehub:rate:${scope}:${subject}`;
  try {
    const client = await getRedisClient();
    if (!client) return memoryHit(key, limit, windowSeconds);
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSeconds);
    return count <= limit;
  } catch {
    return memoryHit(key, limit, windowSeconds);
  }
}
