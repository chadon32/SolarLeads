import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildReportPdfPath } from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";

type LeadBody = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  monthlyBill?: number;
  panelCount?: number;
  systemSizeKw?: number;
  annualSavings?: number;
  monthlySavings?: number;
  annualEnergyKwh?: number;
  roofAreaSqm?: number;
  usableAreaSqm?: number;
  roofPitchDegrees?: number;
  lat?: number;
  lng?: number;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:leads",
      limit: 8,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many lead submissions. Please try again in a minute." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          message:
            "Lead storage is not configured yet. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as LeadBody;
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim();
    const address = body.address?.trim();
    const monthlyBill = Number(body.monthlyBill);
    const annualSavingsOverride = Number(body.annualSavings);
    const panelCount = Number(body.panelCount);
    const estimatedSavings =
      Number.isFinite(annualSavingsOverride) && annualSavingsOverride > 0
        ? Math.round(annualSavingsOverride)
        : null;

    if (
      !name ||
      name.length < 2 ||
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !phone ||
      phone.replace(/\D/g, "").length < 10 ||
      phone.replace(/\D/g, "").length > 15 ||
      !address ||
      address.length < 8 ||
      !Number.isFinite(panelCount) ||
      panelCount < 1 ||
      !estimatedSavings
    ) {
      return NextResponse.json(
        { message: "Missing required lead fields or Solar API analysis values." },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const baseInsert = {
      name,
      email,
      phone,
      address,
      monthly_bill: monthlyBill,
      estimated_savings: estimatedSavings,
    };
    const extendedInsert = {
      ...baseInsert,
      panel_count: toNullableInteger(body.panelCount),
      system_size_kw: toNullableNumber(body.systemSizeKw),
      annual_savings: toNullableNumber(body.annualSavings),
      monthly_savings: toNullableNumber(body.monthlySavings),
      annual_energy_kwh: toNullableNumber(body.annualEnergyKwh),
      roof_area_m2: toNullableNumber(body.roofAreaSqm),
      usable_area_m2: toNullableNumber(body.usableAreaSqm),
      roof_pitch_deg: toNullableNumber(body.roofPitchDegrees),
      lat: toNullableNumber(body.lat),
      lng: toNullableNumber(body.lng),
    };

    let insertResult = await supabase
      .from("leads")
      .insert(extendedInsert)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();

    if (insertResult.error && shouldRetryLegacyInsert(insertResult.error.message)) {
      insertResult = await supabase
        .from("leads")
        .insert(baseInsert)
        .select("id, name, email, address, monthly_bill, estimated_savings")
        .single();
    }

    const { data, error } = insertResult;

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { message: "This lead was already submitted." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { message: error.message || "Unable to save the lead." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lead: {
        id: data.id,
        name: data.name,
        email: data.email,
        address: data.address,
        monthlyBill: data.monthly_bill,
        estimatedSavings: data.estimated_savings,
        reportUrl: buildReportPdfPath(data.id),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unexpected lead save error.",
      },
      { status: 500 }
    );
  }
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function shouldRetryLegacyInsert(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}
