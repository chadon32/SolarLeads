import { NextRequest, NextResponse } from "next/server";
import { maintenanceModeResponse, rateLimitResponse } from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const AZ_SOLAR_RATES: Record<string, number> = {
  "85001": 8.2,
  "85002": 7.9,
  "85003": 8.1,
  "85004": 8.4,
  "85006": 7.8,
  "85007": 7.6,
  "85008": 8.9,
  "85009": 7.5,
  "85012": 9.1,
  "85013": 9.3,
  "85014": 9.8,
  "85015": 8.7,
  "85016": 10.2,
  "85017": 8.1,
  "85018": 11.4,
  "85019": 7.9,
  "85020": 10.1,
  "85021": 9.6,
  "85022": 10.8,
  "85023": 9.4,
  "85024": 10.3,
  "85027": 9.1,
  "85028": 11.2,
  "85029": 8.8,
  "85032": 11.6,
  "85033": 8.2,
  "85034": 7.8,
  "85035": 8.0,
  "85040": 9.2,
  "85041": 8.6,
  "85044": 11.8,
  "85045": 12.1,
  "85048": 13.2,
  "85050": 12.4,
  "85051": 8.9,
  "85053": 9.1,
  "85054": 11.9,
  "85083": 10.7,
  "85085": 11.3,
  "85086": 11.8,
  "85201": 9.1,
  "85202": 9.4,
  "85203": 9.2,
  "85204": 8.8,
  "85205": 9.6,
  "85206": 9.8,
  "85207": 10.1,
  "85208": 9.3,
  "85209": 10.4,
  "85210": 9.1,
  "85212": 11.2,
  "85213": 10.8,
  "85215": 11.4,
  "85224": 10.2,
  "85225": 9.8,
  "85226": 10.6,
  "85233": 11.1,
  "85234": 11.8,
  "85248": 12.4,
  "85249": 12.8,
  "85251": 12.4,
  "85253": 13.1,
  "85254": 12.8,
  "85255": 13.4,
  "85257": 11.2,
  "85258": 12.6,
  "85259": 13.2,
  "85260": 12.9,
  "85262": 13.8,
  "85266": 13.1,
  "85301": 7.8,
  "85302": 8.1,
  "85303": 7.6,
  "85304": 8.3,
  "85305": 7.9,
  "85306": 8.4,
  "85308": 9.2,
  "85310": 9.8,
  "85338": 9.1,
  "85339": 8.6,
  "85340": 10.2,
  "85345": 8.8,
  "85351": 9.4,
  "85353": 8.7,
  "85374": 10.8,
  "85375": 11.2,
  "85379": 10.4,
  "85381": 9.6,
  "85382": 10.1,
  "85383": 10.8,
  "85388": 11.4,
  "85390": 10.6,
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const maintenance = maintenanceModeResponse();
  if (maintenance) return maintenance;

  const limit = await enforceRateLimit({
    request,
    route: "api:neighborhood",
    limit: 60,
    windowMs: 60 * 1000,
  });

  if (!limit.allowed) {
    return rateLimitResponse(
      "Neighborhood estimates are temporarily limited. Please wait and try again.",
      limit.retryAfterSeconds
    );
  }

  const zip = request.nextUrl.searchParams.get("zip")?.trim() ?? "";
  const totalEstimateCount = await getTotalEstimateCount();

  if (!zip) {
    return NextResponse.json({
      totalEstimateCount,
    });
  }

  const rate = AZ_SOLAR_RATES[zip] ?? 8.5;
  const avgHomesPerMile = 120;
  const solarHomes = Math.round(avgHomesPerMile * (rate / 100) * 2);

  return NextResponse.json({
    rate,
    solarHomes,
    totalEstimateCount,
    zip,
  });
}

async function getTotalEstimateCount() {
  try {
    const supabase = getSupabaseAdminClient();
    const { count, error } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    if (error) {
      return 412;
    }

    return (count ?? 0) + 412;
  } catch {
    return 412;
  }
}
