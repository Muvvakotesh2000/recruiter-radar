import { redis } from "./redis";

export const TTL = {
  MX: 7 * 24 * 60 * 60,       // 7 days  (seconds — Redis TTL)
  CATCH_ALL: 3 * 24 * 60 * 60, // 3 days
  EMAIL: 7 * 24 * 60 * 60,     // 7 days
  RESULT: 24 * 60 * 60,        // 1 day  (job results)
};

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

// Distributed lock using Redis SET NX EX
// Returns a release function, or null if lock couldn't be acquired
export async function acquireLock(key: string, ttlSeconds = 30): Promise<(() => Promise<void>) | null> {
  const token = Math.random().toString(36).slice(2);
  const lockKey = `lock:${key}`;
  const result = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
  if (!result) return null;

  return async () => {
    // Only release if we still own the lock (Lua script for atomicity)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, lockKey, token);
  };
}
