import { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  close(): Promise<void>;
}

/** Fixed-window counter in process memory (single instance / tests). */
export function memoryRateLimiter(clock: () => Date = () => new Date()): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, limit, windowSeconds) {
      const now = clock().getTime();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
        buckets.set(key, bucket);
      }
      bucket.count++;
      return {
        allowed: bucket.count <= limit,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      };
    },
    async close() {},
  };
}

/** Fixed-window counter in Redis, shared by all app instances. */
export function redisRateLimiter(url: string): RateLimiter {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  return {
    async hit(key, limit, windowSeconds) {
      const redisKey = `ratelimit:${key}`;
      const [[, count], [, ttl]] = (await redis
        .multi()
        .incr(redisKey)
        .ttl(redisKey)
        .exec()) as [[null, number], [null, number]];
      let reset = ttl;
      if (ttl < 0) {
        await redis.expire(redisKey, windowSeconds);
        reset = windowSeconds;
      }
      return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds: reset };
    },
    async close() {
      await redis.quit();
    },
  };
}
