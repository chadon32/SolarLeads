import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DAY_MS,
  HOUR_MS,
  isHoneypotFilled,
  isLikelyBotAddress,
  isRequestTooLarge,
  isTooFastSubmission,
  logAbuseSignal,
  maintenanceModeResponse,
  payloadTooLargeResponse,
  rateLimitResponse,
  verifyTurnstileToken,
} from "@/lib/abuse-protection";
import { calculateLeadScore } from "@/lib/lead-scoring";
import {
  normalizeAddress,
  normalizeEmail,
  normalizePhone,
} from "@/lib/lead-normalization";
import { formatName } from "@/lib/name-format";
import {
  sendLeadNotifications,
  type LeadNotificationSummary,
  type NotificationResult,
} from "@/lib/notifications";
import { isValidUsPhoneNumber, normalizePhoneNumber } from "@/lib/phone";
import {
  normalizeSolarReportSnapshot,
  type SolarReportSnapshot,
} from "@/lib/report-snapshot";
import { buildReportPdfUrl } from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifyUtilityBillUploadClaim } from "@/lib/utility-bill-claims";

type LeadBody = {
  name?: string;
  email?: string;
  phone?: string;
  companyWebsite?: string;
  formStartedAt?: number;
  bestTimeToContact?: string;
  notes?: string;
  preferredContactMethod?: string;
  quoteRequested?: boolean;
  address?: string;
  electricBillRange?: string;
  monthlyBill?: number;
  ownsHome?: string;
  panelCount?: number;
  systemSizeKw?: number;
  annualSavings?: number;
  monthlySavings?: number;
  annualEnergyKwh?: number;
  energyOffsetPct?: number;
  pdfGenerated?: boolean;
  solarSuitabilityScore?: number;
  twentyYearSavings?: number;
  utilityBillUploadClaim?: string;
  utilityBillUploaded?: boolean;
  roofAreaSqm?: number;
  usableAreaSqm?: number;
  roofPitchDegrees?: number;
  reportSnapshot?: SolarReportSnapshot;
  lat?: number;
  lng?: number;
  batteryAdded?: boolean;
  batteryBrand?: string;
  batteryCost?: number;
  batteryModel?: string;
  federalTaxCredit?: number;
  netSystemCost?: number;
  referredBy?: string;
  selectedInverterType?: string;
  selectedPanelBrand?: string;
  selectedPanelModel?: string;
  selectedPanelWatts?: number;
  solarTimeline?: string;
  systemCostBeforeIncentives?: number;
  turnstileToken?: string;
  website?: string;
};

type ExistingLeadMatch = {
  id: string;
  referral_code?: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    if (isRequestTooLarge(request, 1024 * 1024)) {
      logAbuseSignal(request, "lead-payload-too-large", {
        route: "api:leads",
      });
      return payloadTooLargeResponse("The lead request is too large.");
    }

    const ipLimit = await enforceRateLimit({
      request,
      route: "api:leads",
      limit: 100,
      windowMs: HOUR_MS,
    });

    if (!ipLimit.allowed) {
      logAbuseSignal(request, "lead-rate-limited", {
        route: "api:leads",
        window: "hour",
      });
      return rateLimitResponse(
        "Too many report requests. Please try again later.",
        ipLimit.retryAfterSeconds
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

    const body = (await request.json().catch(() => ({}))) as LeadBody;

    if (isHoneypotFilled(body.website, body.companyWebsite)) {
      logAbuseSignal(request, "lead-honeypot-filled", {
        route: "api:leads",
      });
      return NextResponse.json({
        message: "Your request was received.",
        skipped: true,
      });
    }

    if (isTooFastSubmission(body.formStartedAt)) {
      logAbuseSignal(request, "lead-too-fast", {
        route: "api:leads",
      });
      return NextResponse.json(
        { message: "Please review the form and try again." },
        { status: 400 }
      );
    }

    const turnstile = await verifyTurnstileToken({
      request,
      token: body.turnstileToken,
    });

    if (!turnstile.ok) {
      logAbuseSignal(request, "lead-turnstile-failed", {
        route: "api:leads",
      });
      return NextResponse.json({ message: turnstile.message }, { status: 403 });
    }

    const name = formatName(body.name);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const address = body.address?.trim();
    const normalizedAddress = normalizeAddress(address);
    const quoteRequested = Boolean(body.quoteRequested);
    const preferredContactMethod = toNullableText(body.preferredContactMethod);
    const bestTimeToContact = toNullableText(body.bestTimeToContact);
    const quoteNotes = toNullableText(body.notes);
    const monthlyBill = Number(body.monthlyBill);
    const annualSavingsOverride = Number(body.annualSavings);
    const panelCount = Number(body.panelCount);
    const selectedPanelWatts = Number(body.selectedPanelWatts);
    const netSystemCost = Number(body.netSystemCost);
    const reportSnapshot = normalizeSolarReportSnapshot(body.reportSnapshot);
    const twentyYearSavings =
      toNullableNumber(body.twentyYearSavings) ??
      (Number.isFinite(annualSavingsOverride) && annualSavingsOverride > 0
        ? Math.round(annualSavingsOverride * 20)
        : null);
    const pdfGenerated = body.pdfGenerated ?? true;
    const pdfDownloaded = false;
    const verifiedUtilityBillPath = resolveUtilityBillUploadPath(
      body.utilityBillUploadClaim
    );
    const utilityBillUploaded = Boolean(
      body.utilityBillUploaded && verifiedUtilityBillPath
    );
    const batteryAdded = Boolean(body.batteryAdded);
    const referredBy = toNullableText(body.referredBy)?.toUpperCase() ?? null;
    const utilityBillFilePath = utilityBillUploaded
      ? verifiedUtilityBillPath
      : null;
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
                2.75 *
                0.7) /
              estimatedSavings
            ).toFixed(1)
          )
        : null;
    const leadScore = calculateLeadScore({
      annualSavings: estimatedSavings,
      completedReportRequest: quoteRequested || pdfGenerated,
      email,
      energyOffsetPct: body.energyOffsetPct,
      electricBillRange: body.electricBillRange,
      monthlyBill,
      name,
      ownsHome: body.ownsHome,
      panelCount,
      pdfDownloaded,
      pdfGenerated,
      phone,
      preferredContactMethod,
      quoteRequested,
      roofAreaM2: body.roofAreaSqm,
      selectedPanelBrand: body.selectedPanelBrand,
      selectedPanelModel: body.selectedPanelModel,
      selectedPanelWatts: body.selectedPanelWatts,
      solarSuitabilityScore: body.solarSuitabilityScore,
      solarTimeline: body.solarTimeline,
      systemSizeKw: body.systemSizeKw,
      twentyYearSavings,
      utilityBillUploaded,
      usableRoofAreaM2: body.usableAreaSqm,
      validResidentialAddress: Boolean(address && address.length >= 8),
    });

    if (
      !name ||
      name.length < 2 ||
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !isValidUsPhoneNumber(phone) ||
      !address ||
      isLikelyBotAddress(address) ||
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

    if (!email || !phone) {
      return NextResponse.json(
        { message: "Missing normalized contact information." },
        { status: 400 }
      );
    }

    const safeEmail: string = email;
    const safePhone: string = phone;

    const contactLimits = [
      { key: `email:${safeEmail}`, label: "email" },
      { key: `phone:${safePhone}`, label: "phone" },
      ...(normalizedAddress
        ? [{ key: `address:${normalizedAddress}`, label: "address" }]
        : []),
    ];

    for (const limitTarget of contactLimits) {
      const contactLimit = await enforceRateLimit({
        key: limitTarget.key,
        request,
        route: `api:leads:${limitTarget.label}`,
        limit: limitTarget.label === "address" ? 8 : 5,
        windowMs: DAY_MS,
      });

      if (!contactLimit.allowed) {
        logAbuseSignal(request, "lead-contact-rate-limited", {
          normalizedAddress,
          route: "api:leads",
          target: limitTarget.label,
        });
        return rateLimitResponse(
          "Too many report requests for this contact information today.",
          contactLimit.retryAfterSeconds
        );
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const existingLead = await findExistingLeadMatch(supabase, {
      address,
      normalizedAddress,
      normalizedEmail: email,
      normalizedPhone: phone,
    });
    const referralCode = existingLead?.referral_code ?? createReferralCode();
    const now = new Date().toISOString();

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
      updated_at: now,
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
      battery_added: batteryAdded,
      battery_brand: batteryAdded ? toNullableText(body.batteryBrand) : null,
      battery_cost: batteryAdded ? toNullableInteger(body.batteryCost) : null,
      battery_model: batteryAdded ? toNullableText(body.batteryModel) : null,
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
      referral_code: referralCode,
      referred_by: referredBy,
      report_snapshot: reportSnapshot,
      report_pdf_url: null,
      solar_suitability_score: toNullableInteger(body.solarSuitabilityScore),
      twenty_year_savings: twentyYearSavings,
      utility_bill_file_path: null,
      utility_bill_uploaded: utilityBillUploaded,
      updated_at: now,
      normalized_email: email,
      normalized_phone: phone,
      normalized_address: normalizedAddress,
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
      batteryAdded,
      referredBy,
      utilityBillUploaded,
    });

    const scoredInsertWithoutNewOptionalFields = Object.fromEntries(
      Object.entries(scoredInsert).filter(
        ([key]) =>
          ![
            "battery_added",
            "battery_brand",
            "battery_cost",
            "battery_model",
            "normalized_address",
            "normalized_email",
            "normalized_phone",
            "referral_code",
            "referred_by",
            "report_snapshot",
            "report_pdf_url",
            "utility_bill_file_path",
          ].includes(key)
      )
    );
    const saveResult = existingLead
      ? await updateLeadRecord(
          supabase,
          existingLead.id,
          scoredInsert,
          scoredInsertWithoutNewOptionalFields,
          extendedInsert,
          baseInsert
        )
      : await insertLeadRecord(
          supabase,
          scoredInsert,
          scoredInsertWithoutNewOptionalFields,
          extendedInsert,
          baseInsert
        );

    const { data, error } = saveResult;

    if (error) {
      return NextResponse.json(
        { message: error.message || "Unable to save the lead." },
        { status: 500 }
      );
    }

    const finalizedUtilityBillPath =
      utilityBillUploaded && utilityBillFilePath
        ? await finalizeUtilityBillUpload(
            supabase,
            data.id,
            utilityBillFilePath
          )
        : null;
    const utilityBillStored = Boolean(finalizedUtilityBillPath);

    const reportUrl = buildReportPdfUrl(data.id, {
      absolute: true,
      download: true,
      raw: true,
    });
    await saveReportPdfUrl(supabase, data.id, reportUrl);
    const notificationLimit = await enforceRateLimit({
      key: `lead:${data.id}`,
      request,
      route: "api:leads:notifications",
      limit: 2,
      windowMs: DAY_MS,
    });
    const notificationResults = notificationLimit.allowed
      ? await sendLeadNotifications({
          address,
          adminReportUrl: reportUrl,
          annualSavings: estimatedSavings,
          electricBillRange: toNullableText(body.electricBillRange),
          email: safeEmail,
          leadId: data.id,
          leadScoreLabel: leadScore.label,
          leadScoreValue: leadScore.score,
          monthlyBill,
          name,
          panelCount,
          phone: safePhone,
          preferredContactMethod,
          reportUrl,
          solarTimeline: toNullableText(body.solarTimeline),
          systemSizeKw: toNullableNumber(body.systemSizeKw),
        })
      : buildSkippedNotificationSummary("notification_rate_limited");

    if (!notificationLimit.allowed) {
      logAbuseSignal(request, "lead-notification-rate-limited", {
        leadId: data.id,
        route: "api:leads",
      });
    }

    await saveNotificationStatus(supabase, data.id, notificationResults);

    console.info("[lead-notifications]", notificationResults);

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
        referralCode,
        reportUrl,
        updatedExisting: Boolean(existingLead),
        utilityBillUploaded: utilityBillStored,
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

async function finalizeUtilityBillUpload(
  supabase: SupabaseClient,
  leadId: string,
  sourcePath: string
) {
  const bucketName = "utility-bills";
  const normalizedSourcePath = sourcePath.trim();

  if (!normalizedSourcePath.startsWith("pending/")) {
    return normalizedSourcePath;
  }

  const extension =
    normalizedSourcePath.toLowerCase().match(/\.(pdf|jpg|jpeg|png)$/)?.[0] ??
    ".pdf";
  const finalPath = `leads/${leadId}/utility-bill${
    extension === ".jpeg" ? ".jpg" : extension
  }`;
  const storage = supabase.storage.from(bucketName);

  try {
    const moved = await storage.move(normalizedSourcePath, finalPath);

    if (moved.error) {
      const copied = await storage.copy(normalizedSourcePath, finalPath);

      if (copied.error) {
        console.error("[utility-bill-finalize-copy]", copied.error.message);
        await markUtilityBillUnavailable(supabase, leadId);
        return null;
      }

      await storage.remove([normalizedSourcePath]);
    }

    const { error } = await supabase
      .from("leads")
      .update({
        utility_bill_file_path: finalPath,
        utility_bill_uploaded: true,
      })
      .eq("id", leadId);

    if (error) {
      console.error("[utility-bill-finalize-update]", error.message);
    }

    return finalPath;
  } catch (error) {
    console.error("[utility-bill-finalize]", error);
    await markUtilityBillUnavailable(supabase, leadId);
    return null;
  }
}

async function markUtilityBillUnavailable(
  supabase: SupabaseClient,
  leadId: string
) {
  const { error } = await supabase
    .from("leads")
    .update({
      utility_bill_file_path: null,
      utility_bill_uploaded: false,
    })
    .eq("id", leadId);

  if (error) {
    console.error("[utility-bill-finalize-reset]", error.message);
  }
}

async function saveNotificationStatus(
  supabase: SupabaseClient,
  leadId: string,
  results: LeadNotificationSummary
) {
  const notificationStatus = buildNotificationStatus(results);
  const { error } = await supabase
    .from("leads")
    .update({
      email_error: resultError(results.homeownerEmail),
      email_sent_at: results.homeownerEmail.sentAt ?? null,
      notification_status: notificationStatus,
    })
    .eq("id", leadId);

  if (!error) {
    return;
  }

  if (shouldRetryLegacyInsert(error.message)) {
    console.warn("[lead-notification-status-skipped]", error.message);
    return;
  }

  console.error("[lead-notification-status]", error.message);
}

function buildNotificationStatus(results: LeadNotificationSummary) {
  const email = resultStatus(results.homeownerEmail);

  if (email === "sent") return "homeowner_email_sent";
  if (email === "skipped") return "homeowner_email_skipped";

  return "homeowner_email_failed";
}

function buildSkippedNotificationSummary(reason: string): LeadNotificationSummary {
  return {
    adminEmail: {
      ok: false,
      reason,
      skipped: true,
    },
    homeownerEmail: {
      ok: false,
      reason,
      skipped: true,
    },
  };
}

function resultStatus(result: NotificationResult) {
  if (result.ok) return "sent";
  if (result.skipped) return "skipped";
  return "failed";
}

function resultError(result: NotificationResult) {
  if (result.ok) return null;

  return result.error ?? result.reason ?? null;
}

function resolveUtilityBillUploadPath(uploadClaim?: string) {
  const claim = verifyUtilityBillUploadClaim(uploadClaim);

  if (claim.ok) {
    return claim.path;
  }

  if (uploadClaim) {
    console.warn("[utility-bill-claim]", claim.reason);
  }

  return null;
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

function createReferralCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function insertLeadRecord(
  supabase: SupabaseClient,
  scoredInsert: Record<string, unknown>,
  scoredInsertWithoutNewOptionalFields: Record<string, unknown>,
  extendedInsert: Record<string, unknown>,
  baseInsert: Record<string, unknown>
) {
  let result = await supabase
    .from("leads")
    .insert(scoredInsert)
    .select("id, name, email, address, monthly_bill, estimated_savings")
    .single();

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .insert(scoredInsertWithoutNewOptionalFields)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .insert(extendedInsert)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .insert(baseInsert)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  return result;
}

async function updateLeadRecord(
  supabase: SupabaseClient,
  leadId: string,
  scoredInsert: Record<string, unknown>,
  scoredInsertWithoutNewOptionalFields: Record<string, unknown>,
  extendedInsert: Record<string, unknown>,
  baseInsert: Record<string, unknown>
) {
  let result = await supabase
    .from("leads")
    .update(scoredInsert)
    .eq("id", leadId)
    .select("id, name, email, address, monthly_bill, estimated_savings")
    .single();

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .update(scoredInsertWithoutNewOptionalFields)
      .eq("id", leadId)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .update(extendedInsert)
      .eq("id", leadId)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  if (result.error && shouldRetryLegacyInsert(result.error.message)) {
    result = await supabase
      .from("leads")
      .update(baseInsert)
      .eq("id", leadId)
      .select("id, name, email, address, monthly_bill, estimated_savings")
      .single();
  }

  return result;
}

async function findExistingLeadMatch(
  supabase: SupabaseClient,
  identifiers: {
    address?: string | null;
    normalizedAddress?: string | null;
    normalizedEmail?: string | null;
    normalizedPhone?: string | null;
  }
): Promise<ExistingLeadMatch | null> {
  const byEmail = await findLeadByIdentifier(
    supabase,
    "normalized_email",
    identifiers.normalizedEmail ?? null,
    "email",
    identifiers.normalizedEmail ?? null
  );

  if (byEmail) {
    return byEmail;
  }

  const byPhone = await findLeadByIdentifier(
    supabase,
    "normalized_phone",
    identifiers.normalizedPhone ?? null,
    "phone",
    identifiers.normalizedPhone ?? null
  );

  if (byPhone) {
    return byPhone;
  }

  return findLeadByIdentifier(
    supabase,
    "normalized_address",
    identifiers.normalizedAddress ?? null,
    "address",
    identifiers.address?.trim() ?? null
  );
}

async function findLeadByIdentifier(
  supabase: SupabaseClient,
  normalizedColumn: "normalized_email" | "normalized_phone" | "normalized_address",
  normalizedValue: string | null,
  legacyColumn: "email" | "phone" | "address",
  legacyValue: string | null
): Promise<ExistingLeadMatch | null> {
  if (!normalizedValue && !legacyValue) {
    return null;
  }

  const select = "id, referral_code, created_at";

  if (normalizedValue) {
    const normalizedResult = await supabase
      .from("leads")
      .select(select)
      .eq(normalizedColumn, normalizedValue)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!normalizedResult.error && normalizedResult.data?.length) {
      return normalizedResult.data[0] as ExistingLeadMatch;
    }

    if (
      normalizedResult.error &&
      !shouldRetryLegacyInsert(normalizedResult.error.message)
    ) {
      console.warn("[lead-dedupe-normalized]", normalizedResult.error.message);
    }
  }

  if (!legacyValue) {
    return null;
  }

  const legacyResult = await supabase
    .from("leads")
    .select(select)
    .eq(legacyColumn, legacyValue)
    .order("created_at", { ascending: false })
    .limit(1);

  if (legacyResult.error) {
    console.warn("[lead-dedupe-legacy]", legacyResult.error.message);
    return null;
  }

  return (legacyResult.data?.[0] as ExistingLeadMatch | undefined) ?? null;
}

async function saveReportPdfUrl(
  supabase: SupabaseClient,
  leadId: string,
  reportUrl: string
) {
  const { error } = await supabase
    .from("leads")
    .update({
      report_pdf_url: reportUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (!error || shouldRetryLegacyInsert(error.message)) {
    return;
  }

  console.warn("[lead-report-pdf-url]", error.message);
}

function shouldRetryLegacyInsert(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find")
  );
}
