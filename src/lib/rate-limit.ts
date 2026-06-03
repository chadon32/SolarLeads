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

export async function enforceRateLimit({
  key,
  request,
  route,
  limit,
  windowMs,
}: RateLimitInput): Promise<RateLimitResult> {
  try {
    const supabase = getSupabaseAdminClient();
    const ip = getClientIp(request);
    const identifier = key?.trim() || `ip:${ip}`;
    const keyHash = hashRateLimitKey(route, identifier);
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    const { count, error } = await supabase
      .from("request_events")
      .select("id", { count: "exact", head: true })
      .eq("route", route)
      .eq("key_hash", keyHash)
      .gte("created_at", cutoff);

    if (error) {
      return {
        allowed: true,
        remaining: limit,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    const currentCount = count ?? 0;

    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }

    await supabase.from("request_events").insert({
      route,
      key_hash: keyHash,
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - (currentCount + 1)),
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  } catch {
    return {
      allowed: true,
      remaining: limit,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }
}
