import { ApiError } from "@/auth/api-auth";

/** Fixed-window counters held in process memory. A restart forgets them and a
    second worker would keep its own half — good enough to stop a runaway loop,
    not a billing control. */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

export function take(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function enforce(key: string, limit: number, windowMs: number, label: string): void {
  const result = take(key, limit, windowMs);
  if (!result.ok) {
    throw new ApiError(429, `Rate limit reached (${label}). Retry in ${result.retryAfterSec}s.`);
  }
}

export function generationLimits(): { perMinute: number; perHour: number } {
  return {
    perMinute: intFromEnv("VICEND_API_PER_MIN", 12),
    perHour: intFromEnv("VICEND_API_PER_HOUR", 120),
  };
}

/** Guard against a stuck caller filling the process with bills. */
export function enforceGenerationLimits(identity: { tokenId: number; userId: number }): void {
  const limits = generationLimits();
  enforce(`gen:token:${identity.tokenId}:min`, limits.perMinute, 60_000, `${limits.perMinute}/minute`);
  enforce(`gen:token:${identity.tokenId}:hour`, limits.perHour, 3_600_000, `${limits.perHour}/hour`);
  enforce(`gen:user:${identity.userId}:hour`, limits.perHour * 2, 3_600_000, `${limits.perHour * 2}/hour`);
}

function intFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
