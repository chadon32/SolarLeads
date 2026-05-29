import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { formatDisplayAddress } from "@/lib/address-format";
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
  federalTaxCredit?: number;
  netSystemCost?: number;
  selectedInverterType?: string;
  selectedPanelBrand?: string;
  selectedPanelModel?: string;
  selectedPanelWatts?: number;
  systemCostBeforeIncentives?: number;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY?.trim();
const ownerEmail = process.env.OWNER_EMAIL?.trim();
const resendFromEmail =
  process.env.RESEND_FROM_EMAIL?.trim() || "Arizona Solar AI <onboarding@resend.dev>";

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
    const selectedPanelWatts = Number(body.selectedPanelWatts);
    const netSystemCost = Number(body.netSystemCost);
    const estimatedSavings =
      Number.isFinite(annualSavingsOverride) && annualSavingsOverride > 0
        ? Math.round(annualSavingsOverride)
        : null;
    const roiYears =
      Number.isFinite(netSystemCost) && netSystemCost > 0 && estimatedSavings
        ? Number((netSystemCost / estimatedSavings).toFixed(1))
        : Number.isFinite(panelCount) && panelCount > 0 && estimatedSavings
        ? Number(
            (
              (panelCount *
                (Number.isFinite(selectedPanelWatts) && selectedPanelWatts > 0
                  ? selectedPanelWatts
                  : 400) *
                2.75) /
              estimatedSavings
            ).toFixed(1)
          )
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
      !Number.isFinite(monthlyBill) ||
      monthlyBill <= 0 ||
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
      status: "New",
      panel_count: toNullableInteger(body.panelCount),
      system_size_kw: toNullableNumber(body.systemSizeKw),
      annual_savings: toNullableNumber(body.annualSavings),
      monthly_savings: toNullableNumber(body.monthlySavings),
      annual_energy_kwh: toNullableNumber(body.annualEnergyKwh),
      roi_years: roiYears,
      roof_area_m2: toNullableNumber(body.roofAreaSqm),
      usable_area_m2: toNullableNumber(body.usableAreaSqm),
      roof_pitch_deg: toNullableNumber(body.roofPitchDegrees),
      lat: toNullableNumber(body.lat),
      lng: toNullableNumber(body.lng),
      selected_panel_brand: toNullableText(body.selectedPanelBrand),
      selected_panel_model: toNullableText(body.selectedPanelModel),
      selected_panel_watts: toNullableInteger(body.selectedPanelWatts),
      system_cost_before_incentives: toNullableNumber(body.systemCostBeforeIncentives),
      federal_tax_credit: toNullableNumber(body.federalTaxCredit),
      net_system_cost: toNullableNumber(body.netSystemCost),
      selected_inverter_type: toNullableText(body.selectedInverterType),
    };

    console.info("[lead-insert]", {
      address,
      annualSavings: estimatedSavings,
      panelCount,
      roiYears,
      selectedInverterType: body.selectedInverterType,
      selectedPanel: [body.selectedPanelBrand, body.selectedPanelModel]
        .filter(Boolean)
        .join(" "),
    });

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

    await sendOwnerLeadEmail({
      address,
      annualSavings: estimatedSavings,
      email,
      monthlyBill,
      name,
      panelCount,
      phone,
      roiYears,
      selectedInverterType: toNullableText(body.selectedInverterType),
      selectedPanelBrand: toNullableText(body.selectedPanelBrand),
      selectedPanelModel: toNullableText(body.selectedPanelModel),
      selectedPanelWatts: toNullableInteger(body.selectedPanelWatts),
      systemSizeKw: toNullableNumber(body.systemSizeKw),
    });

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

async function sendOwnerLeadEmail({
  address,
  annualSavings,
  email,
  monthlyBill,
  name,
  panelCount,
  phone,
  roiYears,
  selectedInverterType,
  selectedPanelBrand,
  selectedPanelModel,
  selectedPanelWatts,
  systemSizeKw,
}: {
  address: string;
  annualSavings: number;
  email: string;
  monthlyBill: number;
  name: string;
  panelCount: number;
  phone: string;
  roiYears: number | null;
  selectedInverterType: string | null;
  selectedPanelBrand: string | null;
  selectedPanelModel: string | null;
  selectedPanelWatts: number | null;
  systemSizeKw: number | null;
}) {
  if (!resendApiKey || !ownerEmail) {
    return;
  }

  try {
    const city = address.split(",").map((part) => part.trim())[1] || "Arizona";
    const resend = new Resend(resendApiKey);

    await resend.emails.send({
      from: resendFromEmail,
      to: ownerEmail,
      subject: `New solar lead - ${name} in ${city}`,
      text: [
        `Name: ${name}`,
        `Address: ${formatDisplayAddress(address)}`,
        `Email: ${email}`,
        `Phone: ${phone}`,
        `Monthly bill: $${Math.round(monthlyBill)}`,
        `Annual savings: $${Math.round(annualSavings)}`,
        `System: ${systemSizeKw ?? "Unavailable"} kW / ${panelCount} panels`,
        `Panel: ${
          selectedPanelBrand && selectedPanelModel
            ? `${selectedPanelBrand} ${selectedPanelModel} ${selectedPanelWatts ?? ""}W`.trim()
            : "Unavailable"
        }`,
        `Inverter: ${selectedInverterType ?? "Unavailable"}`,
        `ROI: ${roiYears ?? "Unavailable"} years`,
        `Submitted: ${new Date().toISOString()}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[owner-lead-email]", error);
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

function toNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shouldRetryLegacyInsert(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}
