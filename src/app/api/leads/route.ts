import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { formatDisplayAddress } from "@/lib/address-format";
import { calculateLeadScore } from "@/lib/lead-scoring";
import { buildReportPdfPath } from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";

type LeadBody = {
  name?: string;
  email?: string;
  phone?: string;
  bestTimeToContact?: string;
  notes?: string;
  preferredContactMethod?: string;
  quoteRequested?: boolean;
  address?: string;
  monthlyBill?: number;
  panelCount?: number;
  systemSizeKw?: number;
  annualSavings?: number;
  monthlySavings?: number;
  annualEnergyKwh?: number;
  energyOffsetPct?: number;
  pdfGenerated?: boolean;
  solarSuitabilityScore?: number;
  twentyYearSavings?: number;
  utilityBillUploaded?: boolean;
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
    const quoteRequested = Boolean(body.quoteRequested);
    const preferredContactMethod = toNullableText(body.preferredContactMethod);
    const bestTimeToContact = toNullableText(body.bestTimeToContact);
    const quoteNotes = toNullableText(body.notes);
    const monthlyBill = Number(body.monthlyBill);
    const annualSavingsOverride = Number(body.annualSavings);
    const panelCount = Number(body.panelCount);
    const selectedPanelWatts = Number(body.selectedPanelWatts);
    const netSystemCost = Number(body.netSystemCost);
    const twentyYearSavings =
      toNullableNumber(body.twentyYearSavings) ??
      (Number.isFinite(annualSavingsOverride) && annualSavingsOverride > 0
        ? Math.round(annualSavingsOverride * 20)
        : null);
    const pdfGenerated = body.pdfGenerated ?? true;
    const pdfDownloaded = false;
    const utilityBillUploaded = body.utilityBillUploaded ?? false;
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
    const leadScore = calculateLeadScore({
      annualSavings: estimatedSavings,
      email,
      energyOffsetPct: body.energyOffsetPct,
      panelCount,
      pdfDownloaded,
      pdfGenerated,
      phone,
      quoteRequested,
      solarSuitabilityScore: body.solarSuitabilityScore,
      systemSizeKw: body.systemSizeKw,
      twentyYearSavings,
      utilityBillUploaded,
    });

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
      !estimatedSavings ||
      (quoteRequested && (!preferredContactMethod || !bestTimeToContact))
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
    const leadStatus = quoteRequested ? "Quote Requested" : "New";
    const extendedInsert = {
      ...baseInsert,
      status: leadStatus,
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
    const scoredInsert = {
      ...extendedInsert,
      best_time_to_contact: bestTimeToContact,
      energy_offset_pct: toNullableNumber(body.energyOffsetPct),
      follow_up_notes: quoteNotes,
      follow_up_status: quoteRequested ? "Quote requested" : "Not started",
      lead_score: leadScore.score,
      lead_score_label: leadScore.label,
      pdf_downloaded: pdfDownloaded,
      pdf_generated: pdfGenerated,
      preferred_contact_method: preferredContactMethod,
      quote_notes: quoteNotes,
      quote_requested: quoteRequested,
      quote_requested_at: quoteRequested ? new Date().toISOString() : null,
      solar_suitability_score: toNullableInteger(body.solarSuitabilityScore),
      twenty_year_savings: twentyYearSavings,
      utility_bill_uploaded: utilityBillUploaded,
    };

    console.info("[lead-insert]", {
      address,
      annualSavings: estimatedSavings,
      panelCount,
      leadScore: leadScore.score,
      leadScoreLabel: leadScore.label,
      quoteRequested,
      roiYears,
      selectedInverterType: body.selectedInverterType,
      selectedPanel: [body.selectedPanelBrand, body.selectedPanelModel]
        .filter(Boolean)
        .join(" "),
    });

    let insertResult = await supabase
      .from("leads")
      .insert(scoredInsert)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();

    if (insertResult.error && shouldRetryLegacyInsert(insertResult.error.message)) {
      insertResult = await supabase
        .from("leads")
        .insert(extendedInsert)
        .select("id, name, email, address, monthly_bill, estimated_savings")
        .single();
    }

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
      leadScoreLabel: leadScore.label,
      leadScoreValue: leadScore.score,
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
      bestTimeToContact,
      preferredContactMethod,
      quoteNotes,
      quoteRequested,
    });

    return NextResponse.json({
      lead: {
        id: data.id,
        name: data.name,
        email: data.email,
        address: data.address,
        monthlyBill: data.monthly_bill,
        estimatedSavings: data.estimated_savings,
        leadScore: leadScore.score,
        leadScoreLabel: leadScore.label,
        quoteRequested,
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
  bestTimeToContact,
  email,
  leadScoreLabel,
  leadScoreValue,
  monthlyBill,
  name,
  panelCount,
  phone,
  roiYears,
  preferredContactMethod,
  quoteNotes,
  quoteRequested,
  selectedInverterType,
  selectedPanelBrand,
  selectedPanelModel,
  selectedPanelWatts,
  systemSizeKw,
}: {
  address: string;
  annualSavings: number;
  bestTimeToContact: string | null;
  email: string;
  leadScoreLabel: string;
  leadScoreValue: number;
  monthlyBill: number;
  name: string;
  panelCount: number;
  phone: string;
  roiYears: number | null;
  preferredContactMethod: string | null;
  quoteNotes: string | null;
  quoteRequested: boolean;
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
        `Lead type: ${quoteRequested ? "Quote requested" : "Report requested"}`,
        `Name: ${name}`,
        `Address: ${formatDisplayAddress(address)}`,
        `Email: ${email}`,
        `Phone: ${phone}`,
        `Preferred contact: ${preferredContactMethod ?? "Unavailable"}`,
        `Best time to contact: ${bestTimeToContact ?? "Unavailable"}`,
        `Monthly bill: $${Math.round(monthlyBill)}`,
        `Annual savings: $${Math.round(annualSavings)}`,
        `System: ${systemSizeKw ?? "Unavailable"} kW / ${panelCount} panels`,
        `Panel: ${
          selectedPanelBrand && selectedPanelModel
            ? `${selectedPanelBrand} ${selectedPanelModel} ${selectedPanelWatts ?? ""}W`.trim()
            : "Unavailable"
        }`,
        `Inverter: ${selectedInverterType ?? "Unavailable"}`,
        `Quote notes: ${quoteNotes ?? "None"}`,
        `ROI: ${roiYears ?? "Unavailable"} years`,
        `Lead score: ${leadScoreValue}/100 - ${leadScoreLabel}`,
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
