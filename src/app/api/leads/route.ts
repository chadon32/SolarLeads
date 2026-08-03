import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
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
  readJsonWithLimit,
  rateLimitResponse,
  verifyTurnstileToken,
} from "@/lib/abuse-protection";
import { calculateLeadScore } from "@/lib/lead-scoring";
import { buildConsentEvidence } from "@/lib/consent";
import {
  normalizeAddress,
  normalizeEmail,
  normalizePhone,
} from "@/lib/lead-normalization";
import { selectLeadForNormalizedProperty } from "@/lib/lead-deduplication";
import { deriveLeadSubmissionNumbers } from "@/lib/lead-submission";
import { formatName } from "@/lib/name-format";
import {
  sendLeadNotifications,
  type LeadNotificationSummary,
  type NotificationResult,
} from "@/lib/notifications";
import { isValidUsPhoneNumber } from "@/lib/phone";
import {
  buildAcceptedPanelAnalysisForReport,
  normalizeSolarReportSnapshot,
  rebuildTrustedSolarReportSnapshot,
  type SolarReportSnapshot,
} from "@/lib/report-snapshot";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import {
  verifyRoofAnalysisProof,
  type RoofAnalysisProof,
} from "@/lib/roof-analysis-proof";
import {
  addressesMatch,
  isReasonableMonthlyBill,
} from "@/lib/lead-validation";
import {
  buildReportPdfUrl,
  buildReportViewerUrl,
} from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifyUtilityBillUploadClaim } from "@/lib/utility-bill-claims";
import { BATTERY_OPTIONS } from "@/lib/batteries";
import {
  INVERTER_OPTIONS,
  SOLAR_PANELS,
  getPanelDimensionsMeters,
  getPanelById,
} from "@/lib/solarPanels";
import { z } from "zod";

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
  installerContactConsent?: boolean;
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
  roofAnalysisProof?: RoofAnalysisProof;
  signedRoofAnalysis?: RoofAnalysis;
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

const finiteNumber = z.number().finite();
const leadBodySchema = z.object({
  address: z.string().trim().min(8).max(220),
  annualEnergyKwh: finiteNumber.optional(),
  annualSavings: finiteNumber.optional(),
  automatedContactConsent: z.boolean().optional(),
  batteryAdded: z.boolean().optional(),
  batteryBrand: z.string().trim().max(100).optional(),
  batteryCost: finiteNumber.optional(),
  batteryModel: z.string().trim().max(150).optional(),
  bestTimeToContact: z.string().trim().max(50).optional(),
  companyWebsite: z.string().max(500).optional(),
  electricBillRange: z.string().trim().max(40).optional(),
  email: z.string().trim().max(254),
  energyOffsetPct: finiteNumber.optional(),
  federalTaxCredit: finiteNumber.optional(),
  formStartedAt: finiteNumber,
  installerContactConsent: z.boolean().optional(),
  lat: finiteNumber.optional(),
  lng: finiteNumber.optional(),
  monthlyBill: finiteNumber,
  monthlySavings: finiteNumber.optional(),
  name: z.string().trim().min(2).max(100),
  netSystemCost: finiteNumber.optional(),
  notes: z.string().max(4000).optional(),
  ownsHome: z.string().trim().max(40).optional(),
  panelCount: finiteNumber.optional(),
  pdfGenerated: z.boolean().optional(),
  phone: z.string().trim().max(32).optional(),
  preferredContactMethod: z.string().trim().max(40).optional(),
  quoteRequested: z.boolean().optional(),
  referredBy: z.string().trim().max(64).optional(),
  reportSnapshot: z.unknown().optional(),
  roofAnalysisProof: z
    .object({
      exp: finiteNumber,
      token: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .optional(),
  roofAreaSqm: finiteNumber.optional(),
  roofPitchDegrees: finiteNumber.optional(),
  selectedInverterType: z.string().trim().max(40).optional(),
  selectedPanelBrand: z.string().trim().max(100).optional(),
  selectedPanelModel: z.string().trim().max(150).optional(),
  selectedPanelWatts: finiteNumber.optional(),
  signedRoofAnalysis: z.unknown().optional(),
  solarSuitabilityScore: finiteNumber.optional(),
  solarTimeline: z.string().trim().max(40).optional(),
  systemCostBeforeIncentives: finiteNumber.optional(),
  systemSizeKw: finiteNumber.optional(),
  turnstileToken: z.string().max(4096).optional(),
  twentyYearSavings: finiteNumber.optional(),
  usableAreaSqm: finiteNumber.optional(),
  utilityBillUploadClaim: z.string().max(4096).optional(),
  utilityBillUploaded: z.boolean().optional(),
  website: z.string().max(500).optional(),
});

type ExistingLeadMatch = {
  address?: string | null;
  email?: string | null;
  id: string;
  normalized_address?: string | null;
  normalized_email?: string | null;
  normalized_phone?: string | null;
  phone?: string | null;
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
        { message: "Report requests are temporarily unavailable." },
        { status: 500 }
      );
    }

    const jsonBody = await readJsonWithLimit(request, 1024 * 1024);

    if (!jsonBody.ok && jsonBody.reason === "too_large") {
      logAbuseSignal(request, "lead-payload-too-large", {
        route: "api:leads",
      });
      return payloadTooLargeResponse("The lead request is too large.");
    }

    const parsedBody = leadBodySchema.safeParse(jsonBody.ok ? jsonBody.data : null);

    if (!parsedBody.success) {
      return NextResponse.json(
        { message: "Review the report request fields and try again." },
        { status: 400 }
      );
    }

    const body = parsedBody.data as LeadBody;

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
    const quoteRequested = body.installerContactConsent === true;
    const preferredContactMethod = quoteRequested
      ? toNullableText(body.preferredContactMethod)
      : null;
    const bestTimeToContact =
      quoteRequested && preferredContactMethod === "Phone"
        ? toNullableText(body.bestTimeToContact)
        : null;
    const quoteNotes = toNullableText(body.notes);
    const selectedPanel = resolveTrustedPanel(body);
    const selectedInverter = resolveTrustedInverter(body.selectedInverterType);
    const selectedBattery = resolveTrustedBattery(body);
    const installedCostPerWatt =
      selectedPanel.installedCostPerWatt + selectedInverter.costAdderPerWatt;
    const candidateReportSnapshot = normalizeSolarReportSnapshot(body.reportSnapshot);
    const proof = verifyRoofAnalysisProof({
      address,
      analysis: body.signedRoofAnalysis,
      proof: body.roofAnalysisProof,
    });
    if (!candidateReportSnapshot || !body.signedRoofAnalysis) {
      return NextResponse.json(
        {
          message:
            "This roof analysis could not be verified. Please refresh the estimate and try again.",
        },
        { status: 403 }
      );
    }
    if (!proof.ok) {
      return NextResponse.json(
        {
          message: proof.missingSecret
            ? "Report verification is not configured."
            : proof.expired
              ? "This roof analysis has expired. Please refresh the estimate and try again."
              : "This roof analysis could not be verified. Please refresh the estimate and try again.",
        },
        { status: proof.expired ? 410 : 403 }
      );
    }

    const reportSnapshot = rebuildTrustedSolarReportSnapshot(
      {
        ...candidateReportSnapshot,
        roofAnalysis: buildAcceptedPanelAnalysisForReport(
          body.signedRoofAnalysis,
          getPanelDimensionsMeters(selectedPanel)
        ),
      },
      {
        batteryCost: selectedBattery?.cost ?? 0,
        installedCostPerWatt,
        monthlyBill: body.monthlyBill,
        panelWatts: selectedPanel.watts,
      }
    );
    const leadNumbers = deriveLeadSubmissionNumbers(
      {
        ...body,
        batteryAdded: Boolean(selectedBattery),
        batteryCost: selectedBattery?.cost ?? 0,
        installedCostPerWatt,
        selectedPanelWatts: selectedPanel.watts,
      },
      reportSnapshot
    );
    const monthlyBill = leadNumbers.monthlyBill;
    const panelCount = leadNumbers.panelCount;
    const estimatedSavings = leadNumbers.annualSavings;
    const twentyYearSavings = leadNumbers.twentyYearSavings;
    const roiYears = leadNumbers.roiYears;
    const pdfGenerated = Boolean(body.pdfGenerated);
    const pdfDownloaded = false;
    const verifiedUtilityBillPath = resolveUtilityBillUploadPath(
      body.utilityBillUploadClaim
    );
    const utilityBillUploaded = Boolean(
      body.utilityBillUploaded && verifiedUtilityBillPath
    );
    const batteryAdded = Boolean(selectedBattery);
    const referredBy = toNullableText(body.referredBy)?.toUpperCase() ?? null;
    const utilityBillFilePath = utilityBillUploaded
      ? verifiedUtilityBillPath
      : null;
    const trustedRoofAreaM2 = toNullableNumber(
      reportSnapshot?.metrics.grossRoofAreaM2
    );
    const trustedUsableAreaM2 = toNullableNumber(
      reportSnapshot?.metrics.usableRoofAreaM2
    );
    const trustedRoofPitchDegrees = toNullableNumber(
      reportSnapshot?.metrics.avgPitchDeg
    );
    const trustedSuitabilityScore = toNullableScore(
      reportSnapshot?.solarReadinessScore ??
        reportSnapshot?.roofModelConfidence ??
        reportSnapshot?.roofAnalysis.rooftopConfidenceScore
    );
    const leadScore = calculateLeadScore({
      annualSavings: estimatedSavings,
      completedReportRequest: quoteRequested || pdfGenerated,
      email,
      energyOffsetPct: leadNumbers.energyOffsetPct,
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
      roofAreaM2: trustedRoofAreaM2,
      selectedPanelBrand: selectedPanel.brand,
      selectedPanelModel: selectedPanel.model,
      selectedPanelWatts: selectedPanel.watts,
      solarSuitabilityScore: trustedSuitabilityScore,
      solarTimeline: body.solarTimeline,
      systemSizeKw: leadNumbers.systemSizeKw,
      twentyYearSavings,
      utilityBillUploaded,
      usableRoofAreaM2: trustedUsableAreaM2,
      validResidentialAddress: Boolean(
        proof.ok && body.signedRoofAnalysis?.validSite
      ),
    });

    if (
      !name ||
      name.length < 2 ||
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (Boolean(phone) && !isValidUsPhoneNumber(phone)) ||
      !address ||
      isLikelyBotAddress(address) ||
      !isReasonableMonthlyBill(monthlyBill) ||
      panelCount === null ||
      panelCount < 1 ||
      !estimatedSavings ||
      (reportSnapshot && !addressesMatch(address, reportSnapshot.address)) ||
      (quoteRequested && !preferredContactMethod) ||
      (quoteRequested &&
        preferredContactMethod === "Phone" &&
        (!phone || !bestTimeToContact))
    ) {
      return NextResponse.json(
        { message: "Missing required lead fields or Solar API analysis values." },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { message: "Missing normalized email information." },
        { status: 400 }
      );
    }

    const safeEmail: string = email;
    const safePhone: string = phone ?? "";

    const contactLimits = [
      { key: `email:${safeEmail}`, label: "email" },
      ...(safePhone
        ? [{ key: `phone:${safePhone}`, label: "phone" }]
        : []),
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
    const consent = buildConsentEvidence(
      request,
      quoteRequested,
      preferredContactMethod
    );

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
      panel_count: leadNumbers.panelCount,
      system_size_kw: leadNumbers.systemSizeKw,
      annual_savings: leadNumbers.annualSavings,
      monthly_savings: leadNumbers.monthlySavings,
      annual_energy_kwh: leadNumbers.annualEnergyKwh,
      roi_years: roiYears,
      roof_area_m2: trustedRoofAreaM2,
      usable_area_m2: trustedUsableAreaM2,
      roof_pitch_deg: trustedRoofPitchDegrees,
      lat: toNullableNumber(reportSnapshot?.home?.lat),
      lng: toNullableNumber(reportSnapshot?.home?.lng),
      selected_panel_brand: selectedPanel.brand,
      selected_panel_model: selectedPanel.model,
      selected_panel_watts: selectedPanel.watts,
      system_cost_before_incentives: leadNumbers.systemCostBeforeIncentives,
      federal_tax_credit: leadNumbers.federalTaxCredit,
      net_system_cost: leadNumbers.netSystemCost,
      selected_inverter_type: selectedInverter.id,
    };
    const scoredInsert = {
      ...extendedInsert,
      battery_added: batteryAdded,
      battery_brand: selectedBattery?.brand ?? null,
      battery_cost: selectedBattery?.cost ?? null,
      battery_model: selectedBattery?.model ?? null,
      best_time_to_contact: bestTimeToContact,
      electric_bill_range: toNullableText(body.electricBillRange),
      energy_offset_pct: leadNumbers.energyOffsetPct,
      follow_up_notes: quoteNotes,
      follow_up_status: quoteRequested ? "Quote requested" : "Not started",
      lead_score: leadScore.score,
      lead_score_label: leadScore.label,
      pdf_downloaded: pdfDownloaded,
      pdf_generated: pdfGenerated,
      preferred_contact_method: preferredContactMethod,
      owns_home: toNullableText(body.ownsHome),
      quote_notes: quoteNotes,
      quote_requested: quoteRequested,
      quote_requested_at: quoteRequested ? new Date().toISOString() : null,
      referral_code: referralCode,
      referred_by: referredBy,
      report_snapshot: reportSnapshot,
      report_pdf_url: null,
      solar_suitability_score: trustedSuitabilityScore,
      solar_timeline: toNullableText(body.solarTimeline),
      twenty_year_savings: twentyYearSavings,
      utility_bill_file_path: null,
      utility_bill_uploaded: utilityBillUploaded,
      updated_at: now,
      normalized_email: email,
      normalized_phone: phone,
      normalized_address: normalizedAddress,
      automated_contact_consent: consent.automatedContactConsent,
      consent_disclosure_text: consent.consentDisclosureText,
      consent_disclosure_version: consent.consentDisclosureVersion,
      consent_ip_hash: consent.consentIpHash,
      consent_source: consent.consentSource,
      consent_user_agent_hash: consent.consentUserAgentHash,
      installer_contact_consent: consent.installerContactConsent,
      installer_contact_consent_at: consent.installerContactConsentAt,
      marketing_email_consent: consent.marketingEmailConsent,
      phone_call_consent: consent.phoneCallConsent,
      report_delivery_consent_at: consent.reportDeliveryConsentAt,
      text_message_consent: consent.textMessageConsent,
    };

    console.info("[lead-save:start]", {
      hasReportSnapshot: Boolean(reportSnapshot),
      quoteRequested,
      batteryAdded,
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
            "electric_bill_range",
            "normalized_address",
            "normalized_email",
            "normalized_phone",
            "owns_home",
            "referral_code",
            "referred_by",
            "report_snapshot",
            "report_pdf_url",
            "utility_bill_file_path",
            "automated_contact_consent",
            "consent_disclosure_text",
            "consent_disclosure_version",
            "consent_ip_hash",
            "consent_source",
            "consent_user_agent_hash",
            "installer_contact_consent",
            "installer_contact_consent_at",
            "marketing_email_consent",
            "phone_call_consent",
            "report_delivery_consent_at",
            "text_message_consent",
            "solar_timeline",
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
      console.error("[lead-save:error]", {
        code: "database_write_failed",
      });
      return NextResponse.json(
        { message: "Unable to save the report request." },
        { status: 500 }
      );
    }

    await saveConsentEvent(supabase, data.id, consent);

    const finalizedUtilityBillPath =
      utilityBillUploaded && utilityBillFilePath
        ? await finalizeUtilityBillUpload(
            supabase,
            data.id,
            utilityBillFilePath
          )
        : null;
    const utilityBillStored = Boolean(finalizedUtilityBillPath);

    const developmentBaseUrl =
      process.env.NODE_ENV === "production" ? undefined : new URL(request.url).origin;
    const reportPdfUrl = buildReportPdfUrl(data.id, {
      absolute: true,
      baseUrl: developmentBaseUrl,
      download: true,
      raw: true,
    });
    const reportUrl = buildReportViewerUrl(data.id, {
      absolute: true,
      baseUrl: developmentBaseUrl,
    });
    await saveReportPdfUrl(supabase, data.id, reportPdfUrl);
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
          installerContactConsent: quoteRequested,
          leadScoreLabel: leadScore.label,
          leadScoreValue: leadScore.score,
          monthlyBill,
          name,
          panelCount,
          phone: safePhone,
          preferredContactMethod,
          reportUrl,
          solarTimeline: toNullableText(body.solarTimeline),
          systemSizeKw: leadNumbers.systemSizeKw,
        })
      : buildSkippedNotificationSummary("notification_rate_limited");

    if (!notificationLimit.allowed) {
      logAbuseSignal(request, "lead-notification-rate-limited", {
        leadId: data.id,
        route: "api:leads",
      });
    }

    await saveNotificationStatus(supabase, data.id, notificationResults);

    console.info("[lead-notifications]", {
      adminEmailOk: notificationResults.adminEmail.ok,
      homeownerEmailOk: notificationResults.homeownerEmail.ok,
      leadId: data.id,
    });

    return NextResponse.json({
      lead: {
        id: data.id,
        name: data.name,
        email: data.email,
        address: data.address,
        monthlyBill: data.monthly_bill,
        estimatedSavings: data.estimated_savings,
        emailDeliveryStatus: notificationResults.homeownerEmail.ok
          ? "sent"
          : "delayed",
        quoteRequested,
        referralCode,
        reportSummary: {
          annualSavings: leadNumbers.annualSavings,
          energyOffsetPct: leadNumbers.energyOffsetPct,
          monthlySavings: leadNumbers.monthlySavings,
          panelCount: leadNumbers.panelCount,
          paybackYears: leadNumbers.roiYears,
          systemSizeKw: leadNumbers.systemSizeKw,
        },
        reportUrl,
        updatedExisting: Boolean(existingLead),
        utilityBillUploaded: utilityBillStored,
      },
    });
  } catch (error) {
    console.error("[lead-save:unexpected]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to save the report request. Please try again." },
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
      await storage.remove([finalPath]);
      await markUtilityBillUnavailable(supabase, leadId);
      return null;
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

async function saveConsentEvent(
  supabase: SupabaseClient,
  leadId: string,
  consent: ReturnType<typeof buildConsentEvidence>
) {
  const { error } = await supabase.from("lead_consent_events").insert({
    automated_contact_consent: consent.automatedContactConsent,
    consent_disclosure_text: consent.consentDisclosureText,
    consent_disclosure_version: consent.consentDisclosureVersion,
    consent_ip_hash: consent.consentIpHash,
    consent_source: consent.consentSource,
    consent_user_agent_hash: consent.consentUserAgentHash,
    installer_contact_consent: consent.installerContactConsent,
    lead_id: leadId,
    marketing_email_consent: consent.marketingEmailConsent,
    phone_call_consent: consent.phoneCallConsent,
    report_delivery_consent: true,
    text_message_consent: consent.textMessageConsent,
  });

  if (error) {
    console.warn("[lead-consent-event]", {
      saved: false,
      schemaReady: !shouldRetryLegacyInsert(error.message),
    });
  }
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
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toNullableScore(value: unknown) {
  const parsed = toNullableInteger(value);

  if (parsed === null) {
    return null;
  }

  return Math.max(0, Math.min(100, parsed));
}

function toNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveTrustedPanel(body: LeadBody) {
  const brand = body.selectedPanelBrand?.trim().toLowerCase();
  const model = body.selectedPanelModel?.trim().toLowerCase();
  const watts = Number(body.selectedPanelWatts);

  return (
    SOLAR_PANELS.find(
      (panel) =>
        panel.brand.toLowerCase() === brand &&
        panel.model.toLowerCase() === model &&
        Number.isFinite(watts) &&
        panel.watts === watts
    ) ?? getPanelById()
  );
}

function resolveTrustedInverter(value?: string | null) {
  return (
    INVERTER_OPTIONS.find((option) => option.id === value) ??
    INVERTER_OPTIONS.find((option) => option.id === "string") ??
    INVERTER_OPTIONS[0]
  );
}

function resolveTrustedBattery(body: LeadBody) {
  if (!body.batteryAdded) {
    return null;
  }

  const brand = body.batteryBrand?.trim().toLowerCase();
  const model = body.batteryModel?.trim().toLowerCase();

  return (
    BATTERY_OPTIONS.find(
      (battery) =>
        battery.brand.toLowerCase() === brand &&
        battery.model.toLowerCase() === model
    ) ?? null
  );
}

function createReferralCode() {
  return randomBytes(5).toString("base64url").slice(0, 8).toUpperCase();
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
    identifiers.normalizedEmail ?? null,
    identifiers.normalizedAddress ?? null
  );

  if (byEmail) {
    return byEmail;
  }

  const byPhone = await findLeadByIdentifier(
    supabase,
    "normalized_phone",
    identifiers.normalizedPhone ?? null,
    "phone",
    identifiers.normalizedPhone ?? null,
    identifiers.normalizedAddress ?? null
  );

  if (byPhone) {
    return byPhone;
  }

  // Address-only updates could let someone overwrite another homeowner's lead.
  // Roof-analysis caching already deduplicates paid API work by property.
  return null;
}

async function findLeadByIdentifier(
  supabase: SupabaseClient,
  normalizedColumn: "normalized_email" | "normalized_phone",
  normalizedValue: string | null,
  legacyColumn: "email" | "phone",
  legacyValue: string | null,
  normalizedAddress: string | null
): Promise<ExistingLeadMatch | null> {
  if ((!normalizedValue && !legacyValue) || !normalizedAddress) {
    return null;
  }

  const select =
    "id, referral_code, created_at, email, phone, address, normalized_email, normalized_phone, normalized_address";

  if (normalizedValue) {
    const normalizedResult = await supabase
      .from("leads")
      .select(select)
      .eq(normalizedColumn, normalizedValue)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!normalizedResult.error && normalizedResult.data?.length) {
      const match = selectLeadForNormalizedProperty(
        normalizedResult.data as ExistingLeadMatch[],
        normalizedAddress
      );

      if (match) {
        return match;
      }
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
    .limit(20);

  if (legacyResult.error && shouldRetryLegacyInsert(legacyResult.error.message)) {
    const fallbackResult = await supabase
      .from("leads")
      .select("id, created_at, email, phone, address")
      .eq(legacyColumn, legacyValue)
      .order("created_at", { ascending: false })
      .limit(20);

    if (fallbackResult.error) {
      console.warn("[lead-dedupe-legacy]", {
        available: false,
      });
      return null;
    }

    return (
      selectLeadForNormalizedProperty(
        fallbackResult.data as ExistingLeadMatch[] | null,
        normalizedAddress
      )
    );
  }

  if (legacyResult.error) {
    console.warn("[lead-dedupe-legacy]", legacyResult.error.message);
    return null;
  }

  return (
    selectLeadForNormalizedProperty(
      legacyResult.data as ExistingLeadMatch[] | null,
      normalizedAddress
    )
  );
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
