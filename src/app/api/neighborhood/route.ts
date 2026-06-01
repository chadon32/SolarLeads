import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const AZ_SOLAR_RATES: Record<string, number> = {
  "85001": 8.2,
  "85016": 10.8,
  "85018": 11.4,
  "85021": 9.8,
  "85028": 12.1,
  "85201": 9.1,
  "85215": 13.2,
  "85224": 11.8,
  "85225": 10.7,
  "85251": 12.4,
  "85254": 13.1,
  "85255": 14.6,
  "85260": 13.8,
  "85281": 9.7,
  "85282": 10.3,
  "85286": 12.9,
  "85301": 7.8,
  "85308": 10.4,
  "85331": 11.9,
  "85701": 6.9,
  "85718": 9.3,
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
      return 400;
    }

    return (count ?? 0) + 400;
  } catch {
    return 400;
  }
}
