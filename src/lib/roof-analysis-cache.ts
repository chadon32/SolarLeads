import { normalizeRoofAnalysis, type RoofAnalysis } from "@/lib/roof-analysis";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const CACHE_TABLE = "roof_analysis_cache";
const ANALYSIS_VERSION = 11;

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
      .select("analysis, analysis_version")
      .eq("address_key", addressKey)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    if (data.analysis_version !== ANALYSIS_VERSION) {
      return null;
    }

    return normalizeRoofAnalysis(data.analysis, params.fallback);
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

    await client.from(CACHE_TABLE).upsert(
      {
        address_key: addressKey,
        address: params.address,
        lat: params.lat,
        lng: params.lng,
        analysis_version: ANALYSIS_VERSION,
        analysis: params.analysis,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "address_key",
      }
    );
  } catch {
    // Cache writes are best-effort. Analysis should still succeed without persistence.
  }
}
