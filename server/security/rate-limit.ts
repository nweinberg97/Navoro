/**
 * In-memory token-bucket rate limiter. Suitable for a single-process deployment;
 * a multi-instance deployment would swap this for a shared store (documented gap).
 */
export interface RateLimitRule {
  /** Bucket capacity (burst). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  #buckets = new Map<string, Bucket>();
  #rule: RateLimitRule;
  #clock: () => number;

  constructor(rule: RateLimitRule, clock: () => number = () => Date.now()) {
    this.#rule = rule;
    this.#clock = clock;
  }

  /** Returns 0 when allowed, otherwise the number of seconds to wait. */
  take(key: string, cost = 1): number {
    const nowMs = this.#clock();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#rule.capacity, updatedAt: nowMs };
    const elapsed = (nowMs - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.#rule.capacity, bucket.tokens + elapsed * this.#rule.refillPerSecond);
    bucket.updatedAt = nowMs;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.#buckets.set(key, bucket);
      return 0;
    }
    this.#buckets.set(key, bucket);
    if (this.#buckets.size > 50_000) this.#sweep(nowMs);
    return Math.ceil((cost - bucket.tokens) / this.#rule.refillPerSecond);
  }

  #sweep(nowMs: number): void {
    const fullAfterMs = (this.#rule.capacity / this.#rule.refillPerSecond) * 1000;
    for (const [key, bucket] of this.#buckets) {
      if (nowMs - bucket.updatedAt > fullAfterMs) this.#buckets.delete(key);
    }
  }
}
