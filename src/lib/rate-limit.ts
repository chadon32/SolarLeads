import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type RateLimitInput = {
  key?: string | null;
  request: Request;
  route: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult =
  | {
      allowed: true;
      remaining: number;
      retryAfterSeconds: number;
    }
  | {
      allowed: false;
      remaining: 0;
      retryAfterSeconds: number;
    };

const memoryWindows = new Map<string, { count: number; startedAt: number }>();

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const cfIp = request.headers.get("cf-connecting-ip");
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  const raw = forwarded ?? realIp ?? cfIp ?? vercelIp ?? "unknown";

  return raw.split(",")[0]?.trim().toLowerCase() || "unknown";
}

function hashRateLimitKey(route: string, identifier: string) {
  const secret = process.env.RATE_LIMIT_SECRET?.trim() ?? "dev-rate-limit-secret";
  return createHash("sha256")
    .update(`${secret}:${route}:${identifier}`)
    .digest("hex");
}

const DEV_RATE_LIMIT_MULTIPLIER = 20;

export async function enforceRateLimit({
  key,
  request,
  route,
  limit: requestedLimit,
  windowMs,
}: RateLimitInput): Promise<RateLimitResult> {
  const limit =
    process.env.NODE_ENV === "production"
      ? requestedLimit
      : requestedLimit * DEV_RATE_LIMIT_MULTIPLIER;

  try {
    const supabase = getSupabaseAdminClient();
    const ip = getClientIp(request);
    const identifier = key?.trim() || `ip:${ip}`;
    const keyHash = hashRateLimitKey(route, identifier);
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const atomicResult = await supabase.rpc("enforce_request_rate_limit", {
      p_key_hash: keyHash,
      p_limit: limit,
      p_route: route,
      p_window_seconds: windowSeconds,
    });

    if (!atomicResult.error) {
      const row = Array.isArray(atomicResult.data)
        ? atomicResult.data[0]
        : atomicResult.data;
      const allowed = Boolean(row?.allowed);
      const currentCount = Number(row?.current_count ?? (allowed ? 1 : limit));

      return allowed
        ? {
            allowed: true,
            remaining: Math.max(0, limit - currentCount),
            retryAfterSeconds: windowSeconds,
          }
        : {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: windowSeconds,
          };
    }

    const cutoff = new Date(Date.now() - windowMs).toISOString();

    const { count, error } = await supabase
      .from("request_events")
      .select("id", { count: "exact", head: true })
      .eq("route", route)
      .eq("key_hash", keyHash)
      .gte("created_at", cutoff);

    if (error) {
      return enforceMemoryRateLimit(keyHash, limit, windowMs);
    }

    const currentCount = count ?? 0;

    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }

    const insertResult = await supabase.from("request_events").insert({
      route,
      key_hash: keyHash,
    });

    if (insertResult.error) {
      return enforceMemoryRateLimit(keyHash, limit, windowMs);
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - (currentCount + 1)),
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  } catch {
    const ip = getClientIp(request);
    const identifier = key?.trim() || `ip:${ip}`;
    return enforceMemoryRateLimit(
      hashRateLimitKey(route, identifier),
      limit,
      windowMs
    );
  }
}

function enforceMemoryRateLimit(
  keyHash: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const current = memoryWindows.get(keyHash);
  const window =
    !current || now - current.startedAt >= windowMs
      ? { count: 0, startedAt: now }
      : current;

  if (window.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowMs - (now - window.startedAt)) / 1000)
      ),
    };
  }

  window.count += 1;
  memoryWindows.set(keyHash, window);
  pruneMemoryWindows(now, windowMs);

  return {
    allowed: true,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
  };
}

function pruneMemoryWindows(now: number, windowMs: number) {
  if (memoryWindows.size < 2_000) {
    return;
  }

  for (const [key, value] of memoryWindows) {
    if (now - value.startedAt >= windowMs) {
      memoryWindows.delete(key);
    }
  }
}
