import { createClient } from "redis";

type PureHubRedisClient = ReturnType<typeof createClient>;

const globalForRedis = globalThis as unknown as {
  purehubRedis?: PureHubRedisClient;
  purehubRedisConnect?: Promise<unknown>;
};

export async function getRedisClient() {
  const url = process.env.REDIS_URL ?? (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT ?? "6379"}` : undefined);
  if (!url) return null;
  if (!globalForRedis.purehubRedis) {
    const client = createClient({ url }) as unknown as PureHubRedisClient;
    client.on("error", () => undefined);
    globalForRedis.purehubRedis = client;
    globalForRedis.purehubRedisConnect = client.connect();
  }
  await globalForRedis.purehubRedisConnect;
  return globalForRedis.purehubRedis;
}

export const authSecondaryStorage = {
  async get(key: string) {
    return (await getRedisClient())?.get(key) ?? null;
  },
  async set(key: string, value: string, ttl?: number) {
    const client = await getRedisClient();
    if (!client) return;
    if (ttl) await client.set(key, value, { EX: ttl });
    else await client.set(key, value);
  },
  async delete(key: string) {
    await (await getRedisClient())?.del(key);
  },
  async increment(key: string, ttl?: number) {
    const client = await getRedisClient();
    if (!client) return 1;
    const count = await client.incr(key);
    if (count === 1 && ttl) await client.expire(key, ttl);
    return count;
  }
};
