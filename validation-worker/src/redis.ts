import Redis from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

// Separate connections for BullMQ (it needs dedicated connections)
export function createRedis() {
  return new Redis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
}

// Shared connection for cache/results
export const redis = createRedis();
