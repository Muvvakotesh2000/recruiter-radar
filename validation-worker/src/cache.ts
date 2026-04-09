interface CacheEntry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const TTL = {
  MX: 7 * 24 * 60 * 60 * 1000,       // 7 days
  CATCH_ALL: 3 * 24 * 60 * 60 * 1000, // 3 days
  EMAIL: 7 * 24 * 60 * 60 * 1000,     // 7 days
};

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Periodically evict expired entries so memory doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expires) store.delete(key);
  }
}, 60 * 60 * 1000); // every hour
