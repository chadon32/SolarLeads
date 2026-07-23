import "server-only";
import { normalizeRoofAnalysis, type RoofAnalysis } from "@/lib/roof-analysis";
import { normalizeAddress } from "@/lib/lead-normalization";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const CACHE_TABLE = "roof_analysis_cache";
// Bump when RoofAnalysis panel geometry, segment outlines, or recommended
// default panel count policy changes so stale cache rows recompute.
// v26: terrain filters — neighbor separation (ground gap or height step)
// plus per-panel off-plane exclusion (modules hanging past the roof edge).

const ANALYSIS_VERSION = 28;
const CACHE_TTL_MS = Number(process.env.ROOF_ANALYSIS_CACHE_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

type CacheLookupParams = {
  address: string;
  lat: number;
  lng: number;
  fallback: RoofAnalysis;
};

export function buildRoofAnalysisCacheKey(params: {
  address: string;
  lat: number;
  lng: number;
}) {
  return `${params.address.trim().toLowerCase()}::${params.lat.toFixed(
    5
  )}::${params.lng.toFixed(5)}`;
}

export async function getCachedRoofAnalysis(
  params: CacheLookupParams
): Promise<RoofAnalysis | null> {
  try {
    const client = getSupabaseAdminClient();
    const addressKey = buildRoofAnalysisCacheKey(params);
    const { data, error } = await client
      .from(CACHE_TABLE)
      .select("analysis, analysis_version, expires_at")
      .eq("address_key", addressKey)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    if (data.analysis_version !== ANALYSIS_VERSION) {
      return null;
    }

    if (isExpired(data.expires_at)) {
      return null;
    }

    return normalizeRoofAnalysis(data.analysis, params.fallback);
  } catch {
    return null;
  }
}

export async function getCachedRoofAnalysisByAddress(
  address: string
): Promise<RoofAnalysis | null> {
  const normalizedAddress = normalizeAddress(address);

  if (!normalizedAddress) {
    return null;
  }

  try {
    const client = getSupabaseAdminClient();
    let result = await client
      .from(CACHE_TABLE)
      .select("address, lat, lng, analysis, analysis_version, expires_at")
      .eq("normalized_address", normalizedAddress)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error && isMissingColumnError(result.error.message)) {
      result = await client
        .from(CACHE_TABLE)
        .select("address, lat, lng, analysis, analysis_version, expires_at")
        .ilike("address", address.trim())
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (result.error || !result.data || result.data.analysis_version !== ANALYSIS_VERSION) {
      return null;
    }

    if (isExpired(result.data.expires_at)) {
      return null;
    }

    return normalizeRoofAnalysis(result.data.analysis, result.data.analysis);
  } catch {
    return null;
  }
}

export async function saveCachedRoofAnalysis(params: {
  address: string;
  lat: number;
  lng: number;
  analysis: RoofAnalysis;
}) {
  try {
    const client = getSupabaseAdminClient();
    const addressKey = buildRoofAnalysisCacheKey(params);
    const now = Date.now();
    const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();
    const row = {
      address_key: addressKey,
      address: params.address,
      normalized_address: normalizeAddress(params.address),
      lat: params.lat,
      lng: params.lng,
      analysis_version: ANALYSIS_VERSION,
      analysis: params.analysis,
      expires_at: expiresAt,
      updated_at: new Date(now).toISOString(),
    };

    const result = await client.from(CACHE_TABLE).upsert(row, {
      onConflict: "address_key",
    });

    if (result.error && isMissingColumnError(result.error.message)) {
      const legacyRow = {
        address_key: addressKey,
        address: params.address,
        lat: params.lat,
        lng: params.lng,
        analysis_version: ANALYSIS_VERSION,
        analysis: params.analysis,
        updated_at: new Date(now).toISOString(),
      };

      await client.from(CACHE_TABLE).upsert(
        legacyRow,
        {
          onConflict: "address_key",
        }
      );
    }
  } catch {
    // Cache writes are best-effort. Analysis should still succeed without persistence.
  }
}

function isExpired(value?: string | null) {
  if (!value) {
    return false;
  }

  const expiresAt = new Date(value).getTime();

  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isMissingColumnError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}
