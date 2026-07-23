import { NextRequest, NextResponse } from "next/server";
import {
  maintenanceModeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

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
      "Report activity is temporarily limited. Please wait and try again.",
      limit.retryAfterSeconds
    );
  }

  return NextResponse.json({
    totalEstimateCount: await getTotalEstimateCount(),
  });
}

async function getTotalEstimateCount() {
  try {
    const supabase = getSupabaseAdminClient();
    const { count, error } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true });

    if (error) {
      return null;
    }

    return count ?? 0;
  } catch {
    return null;
  }
}
