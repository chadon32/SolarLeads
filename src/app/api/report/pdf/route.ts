import { NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle as clippingRectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import * as QRCode from "qrcode";
import { z } from "zod";
import {
  buildSolarReportFromSolarValues,
  type SolarReport,
} from "@/lib/solar-report";
import {
  APP_CANONICAL_URL,
  APP_NAME,
  APP_REPORT_NAME,
} from "@/lib/brand";
import { getPublicSiteUrl } from "@/lib/public-site-url";
import {
  buildSolarAdvisorProfile,
  calculateSolarReadinessScore,
  type SolarAdvisorProfile,
} from "@/lib/solar-advisor";
import {
  calculateLeadScore,
  normalizeLeadScoreLabel,
  type LeadScoreLabel,
} from "@/lib/lead-scoring";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { formatName } from "@/lib/name-format";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  buildReportViewerPath,
  verifyReportSignature,
} from "@/lib/report-access";
import {
  DAY_MS,
  disabledFeatureResponse,
  isKillSwitchEnabled,
  logAbuseSignal,
  maintenanceModeResponse,
  rateLimitResponse,
} from "@/lib/abuse-protection";
import {
  buildRoofAnalysisStaticMapUrl,
  getRoofAnalysisViewport,
  type RoofViewportPoint,
} from "@/lib/roof-analysis-viewport";
import {
  getRoofAnalysisSnapshotPoints,
  normalizeSolarReportSnapshot,
  type SolarReportSnapshot,
} from "@/lib/report-snapshot";
import { buildReportRoofIllustration } from "@/lib/report-roof-illustration";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
  getFederalResidentialSolarCreditRate,
} from "@/lib/financial-model";
import {
  calculateEnergyOffsetPct,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-metrics";

export const runtime = "nodejs";

type Color = ReturnType<typeof rgb>;
type SourceLabel =
  | "Solar API"
  | "Modeled"
  | "Modeled from panel layout"
  | "User-adjusted"
  | "Illustrative"
  | "Estimated"
  | "Utility Bill"
  | "Requested"
  | "Next Step"
  | "Installer Verification Required";

type ReportLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  monthly_bill: number | null;
  estimated_savings?: number | null;
  created_at: string;
  panel_count?: number | null;
  system_size_kw?: number | null;
  annual_savings?: number | null;
  monthly_savings?: number | null;
  annual_energy_kwh?: number | null;
  roof_area_m2?: number | null;
  usable_area_m2?: number | null;
  roof_pitch_deg?: number | null;
  selected_panel_brand?: string | null;
  selected_panel_model?: string | null;
  selected_panel_watts?: number | null;
  system_cost_before_incentives?: number | null;
  net_system_cost?: number | null;
  energy_offset_pct?: number | null;
  lead_score?: number | null;
  lead_score_label?: string | null;
  pdf_downloaded?: boolean | null;
  pdf_generated?: boolean | null;
  quote_requested?: boolean | null;
  solar_suitability_score?: number | null;
  twenty_year_savings?: number | null;
  utility_bill_uploaded?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  report_snapshot?: SolarReportSnapshot | null;
};

type LeadQueryResult = {
  data: ReportLead | null;
  error: { message: string } | null;
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type PdfColors = ReturnType<typeof createColors>;

type ProposalData = {
  id: string;
  name: string;
  address: string;
  email: string;
  phone: string;
  lat?: number;
  lng?: number;
  generatedDate: string;
  confidence: "High" | "Good" | "Moderate" | "Limited";
  systemKwSource: SourceLabel;
  monthlyBill?: number;
  annualSavings?: number;
  monthlySavings?: number;
  twentyYearSavings?: number;
  panelCount?: number;
  systemKw?: number;
  annualKwh?: number;
  energyOffsetPct?: number;
  annualImpactLbs?: number;
  roiYears?: number;
  grossPaybackYears?: number;
  netPaybackYears?: number;
  leadScore: number;
  leadScoreLabel: LeadScoreLabel;
  quoteRequested: boolean;
  utilityBillUploaded: boolean;
  selectedPanelBrand?: string;
  selectedPanelModel?: string;
  selectedPanelWatts?: number;
  panelSizeLabel: string;
  roofAreaSqFt?: number;
  usableAreaSqFt?: number;
  usableRoofPct?: number;
  roofPitchDeg?: number;
  sunlightHours?: number;
  suitabilityScore: number;
  suitabilityLabel: string;
  installedCost?: number;
  costWithoutSolar20Yr?: number;
  costWithSolar20Yr?: number;
  advisor: SolarAdvisorProfile;
  reportSnapshot: SolarReportSnapshot | null;
  roofIllustration: ReturnType<typeof buildReportRoofIllustration>;
};

type PdfAssets = {
  roofImage: PDFImage | null;
  roofImageViewport: RoofImageViewport | null;
  qrImage: PDFImage | null;
};

type RoofImageViewport = {
  center: RoofViewportPoint;
  height: number;
  width: number;
  zoom: number;
};

export async function GET(request: Request) {
  try {
    const maintenance = maintenanceModeResponse();

    if (maintenance) {
      return maintenance;
    }

    const rateLimit = await enforceRateLimit({
      request,
      route: "api:report-pdf",
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many report downloads. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const leadIdResult = z.string().uuid().safeParse(searchParams.get("leadId"));
    const exp = searchParams.get("exp");
    const token = searchParams.get("token");

    if (!leadIdResult.success) {
      return NextResponse.json({ message: "Invalid report ID." }, { status: 400 });
    }
    const leadId = leadIdResult.data;

    const raw = searchParams.get("raw") === "1" || searchParams.get("download") === "1";
    const reportAccess = verifyReportAccess(request, leadId, exp, token);

    if (!reportAccess.ok) {
      return reportAccess.response;
    }

    if (!raw) {
      const viewerPath = reportAccess.dashboardAccess
        ? `/report/${encodeURIComponent(leadId)}`
        : buildReportViewerPath(leadId, {
            expiresAt: Number(exp),
          });

      return NextResponse.redirect(new URL(viewerPath, request.url));
    }

    if (isKillSwitchEnabled("DISABLE_PDF_GENERATION")) {
      logAbuseSignal(request, "pdf-generation-disabled", {
        leadId,
        route: "api:report-pdf",
      });
      return disabledFeatureResponse(
        "Report PDF generation is temporarily unavailable. Please try again shortly."
      );
    }

    const leadPdfLimit = await enforceRateLimit({
      key: `lead:${leadId}`,
      request,
      route: "api:report-pdf:lead",
      limit: 3,
      windowMs: DAY_MS,
    });

    if (!leadPdfLimit.allowed) {
      logAbuseSignal(request, "pdf-generation-rate-limited", {
        leadId,
        route: "api:report-pdf",
      });
      return rateLimitResponse(
        "This report has reached its daily PDF generation limit.",
        leadPdfLimit.retryAfterSeconds
      );
    }

    const supabase = getSupabaseAdminClient();
    const scoredLeadSelect =
      "id, name, email, phone, address, monthly_bill, estimated_savings, created_at, panel_count, system_size_kw, annual_savings, monthly_savings, annual_energy_kwh, roof_area_m2, usable_area_m2, roof_pitch_deg, selected_panel_brand, selected_panel_model, selected_panel_watts, system_cost_before_incentives, net_system_cost, energy_offset_pct, lead_score, lead_score_label, pdf_downloaded, pdf_generated, quote_requested, solar_suitability_score, twenty_year_savings, utility_bill_uploaded, lat, lng, report_snapshot";
    const extendedLeadSelect =
      "id, name, email, phone, address, monthly_bill, estimated_savings, created_at, panel_count, system_size_kw, annual_savings, monthly_savings, annual_energy_kwh, roof_area_m2, usable_area_m2, roof_pitch_deg, selected_panel_brand, selected_panel_model, selected_panel_watts, lat, lng";
    const baseLeadSelect =
      "id, name, email, phone, address, monthly_bill, estimated_savings, created_at";

    let leadResult = (await supabase
      .from("leads")
      .select(scoredLeadSelect)
      .eq("id", leadId)
      .single()) as unknown as LeadQueryResult;

    if (leadResult.error && shouldRetryLegacySelect(leadResult.error.message)) {
      leadResult = (await supabase
        .from("leads")
        .select(extendedLeadSelect)
        .eq("id", leadId)
        .single()) as unknown as LeadQueryResult;
    }

    if (leadResult.error && shouldRetryLegacySelect(leadResult.error.message)) {
      leadResult = (await supabase
        .from("leads")
        .select(baseLeadSelect)
        .eq("id", leadId)
        .single()) as unknown as LeadQueryResult;
    }

    const { data: lead, error } = leadResult;

    if (error || !lead) {
      return NextResponse.json(
        { message: "Report not found." },
        { status: 404 }
      );
    }

    const reportSnapshot = await loadBestReportSnapshotForPdf(lead);
    const report = buildSolarReportFromSolarValues({
      annualSavings: toFiniteNumber(
        lead.annual_savings ?? lead.estimated_savings
      ),
      annualKwh: toFiniteNumber(lead.annual_energy_kwh),
      carbonOffsetFactorKgPerMwh:
        reportSnapshot?.roofAnalysis.carbonOffsetFactorKgPerMwh,
      panelCount: toFiniteNumber(lead.panel_count),
      systemKw: toFiniteNumber(lead.system_size_kw),
      monthlyBill: toFiniteNumber(lead.monthly_bill),
    });

    const pdf = await PDFDocument.create();
    const fonts = {
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      regular: await pdf.embedFont(StandardFonts.Helvetica),
    };
    const colors = createColors();
    const proposal = buildProposalData(lead, report, reportSnapshot);
    const roofAsset = await loadRoofImage(pdf, proposal);
    const assets: PdfAssets = {
      roofImage: roofAsset.image,
      roofImageViewport: roofAsset.viewport,
      qrImage: await loadQrImage(pdf, buildEstimateUrl(proposal.address)),
    };

    drawExecutiveSummary(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawRoofAnalysisPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawSolarReadinessPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawPanelLayoutPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawSunlightAnalysisPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawSavingsPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawFinancingPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawAiSolarAdvisorPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawNextStepsPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawInstallerVerificationPage(pdf.addPage([612, 792]), proposal, fonts, colors);

    pdf.setTitle(`${APP_REPORT_NAME} - ${sanitizePdfText(proposal.address)}`);
    pdf.setAuthor(APP_NAME);
    pdf.setSubject("Preliminary solar analysis; installer verification required");
    pdf.setLanguage("en-US");
    pdf.getPages().forEach((page, index) => {
      page.drawText(`${index + 1} / ${pdf.getPageCount()}`, {
        x: 530, y: 30, size: 7.5, font: fonts.regular, color: colors.muted,
      });
    });
    const bytes = await pdf.save();
    // Do not record a completed report until the document actually exists.
    await markPdfDownloaded(supabase, lead.id, proposal);

    const disposition =
      searchParams.get("download") === "1" ? "attachment" : "inline";

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${buildPdfFilename(proposal)}"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    console.error("[report-pdf:error]", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to generate this report right now." },
      { status: 500 }
    );
  }
}

function verifyReportAccess(
  request: Request,
  leadId: string,
  exp: string | null,
  token: string | null
):
  | { ok: true; dashboardAccess?: boolean }
  | { ok: false; response: NextResponse } {
  const dashboardAuth = verifyDashboardRequest(request);

  if (dashboardAuth.ok) {
    return { ok: true, dashboardAccess: true };
  }

  const signature = verifyReportSignature(leadId, exp, token);

  if (signature.ok) {
    return { ok: true };
  }

  const message = signature.missingSecret
    ? `Report links are not configured. Please contact ${APP_NAME} for a fresh report link.`
    : signature.expired
      ? "This report link has expired. Please request a fresh report link."
      : "This report link is invalid or missing a signature.";

  return {
    ok: false,
    response: NextResponse.json(
      { message },
      {
        status: signature.expired ? 410 : 403,
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      }
    ),
  };
}

async function loadBestReportSnapshotForPdf(
  lead: ReportLead
): Promise<SolarReportSnapshot | null> {
  const storedSnapshot = normalizeSolarReportSnapshot(lead.report_snapshot);

  console.info("[pdf-roof-snapshot]", {
    confidence: storedSnapshot?.roofModelConfidence ?? null,
    leadId: lead.id,
    panelCount: storedSnapshot?.panelCount ?? null,
    source: storedSnapshot ? "stored" : "unavailable",
  });

  // Exact PDF layouts must come from the same immutable snapshot saved by the
  // live analysis. Rebuilding here can drift from what the homeowner reviewed.
  return storedSnapshot;
}

function buildProposalData(
  lead: ReportLead,
  report: SolarReport,
  reportSnapshot: SolarReportSnapshot | null
): ProposalData {
  const snapshotMetrics = reportSnapshot?.metrics ?? null;
  const snapshotAnalysis = reportSnapshot?.roofAnalysis ?? null;
  const monthlyBill = nonNegativeNumber(lead.monthly_bill ?? reportSnapshot?.monthlyBill);
  const annualSavings = nonNegativeNumber(
    snapshotMetrics?.annualSavings ??
      lead.annual_savings ??
      lead.estimated_savings
  );
  const monthlySavings =
    nonNegativeNumber(snapshotMetrics?.monthlySavings ?? lead.monthly_savings) ??
    (annualSavings !== undefined ? annualSavings / 12 : undefined);
  const panelCount =
    nonNegativeNumber(reportSnapshot?.panelCount ?? snapshotMetrics?.panelCount) ??
    positiveNumber(lead.panel_count) ??
    positiveNumber(report.panelCount);
  const annualKwh = nonNegativeNumber(
    snapshotMetrics?.annualKwh ?? lead.annual_energy_kwh
  );
  const directSystemKw = nonNegativeNumber(
    snapshotMetrics?.systemKw ?? lead.system_size_kw
  );
  const systemKw =
    directSystemKw ??
    (panelCount
      ? Number(
          (
            (panelCount *
              (positiveNumber(lead.selected_panel_watts) ??
                STANDARD_PANEL_WATTS)) /
            1000
          ).toFixed(2)
        )
      : undefined);
  const roofAreaSqFt = metersToSqFt(
    positiveNumber(snapshotMetrics?.grossRoofAreaM2 ?? lead.roof_area_m2)
  );
  const usableAreaSqFt = metersToSqFt(
    positiveNumber(snapshotMetrics?.usableRoofAreaM2 ?? lead.usable_area_m2)
  );
  const usableRoofPct =
    positiveNumber(snapshotMetrics?.usablePctRoof) ??
    (roofAreaSqFt && usableAreaSqFt
      ? clamp(Math.round((usableAreaSqFt / roofAreaSqFt) * 100), 1, 100)
      : undefined);
  // kWh / kW is specific yield, not the saved Solar API sunlight-hours metric.
  const sunlightHours = nonNegativeNumber(snapshotAnalysis?.annualSunlightHours);
  const installedCost = positiveNumber(lead.system_cost_before_incentives) ?? (systemKw
    ? systemKw * 1000 * INSTALLED_COST_PER_WATT
    : panelCount
      ? panelCount * STANDARD_PANEL_WATTS * INSTALLED_COST_PER_WATT
      : undefined);
  const netSystemCost = positiveNumber(lead.net_system_cost) ??
    (installedCost
      ? installedCost - calculateFederalResidentialSolarCredit(installedCost)
      : undefined);
  const grossPaybackYears =
    annualSavings && installedCost
      ? Number((installedCost / annualSavings).toFixed(1))
      : undefined;
  const netPaybackYears =
    annualSavings && netSystemCost
      ? Number((netSystemCost / annualSavings).toFixed(1))
      : undefined;
  const roiYears = netPaybackYears;
  const twentyYearCosts =
    monthlyBill && annualSavings !== undefined && netSystemCost !== undefined
      ? calculateTwentyYearSolarCosts({
          annualSavings,
          monthlyBill,
          totalSolarPayments: netSystemCost,
        })
      : null;
  const twentyYearSavings =
    typeof lead.twenty_year_savings === "number" && Number.isFinite(lead.twenty_year_savings)
      ? lead.twenty_year_savings
      : twentyYearCosts?.totalSavings;
  const costWithoutSolar20Yr = twentyYearCosts?.totalCostWithoutSolar;
  const costWithSolar20Yr = twentyYearCosts?.totalCostWithSolar;
  const annualImpactLbs = annualKwh === undefined ? undefined : buildSolarReportFromSolarValues({
    annualKwh, annualSavings: 0, panelCount: panelCount ?? 0,
    carbonOffsetFactorKgPerMwh: snapshotAnalysis?.carbonOffsetFactorKgPerMwh,
  }).annualImpactLbs;
  const energyOffsetPct =
    nonNegativeNumber(snapshotMetrics?.coveragePct) ??
    (annualKwh !== undefined && monthlyBill
      ? calculateEnergyOffsetPct(annualKwh, monthlyBill)
      : nonNegativeNumber(lead.energy_offset_pct));
  const suitabilityScore = calculateSolarReadinessScore({
    annualSunlightHours: sunlightHours ?? 0,
    coveragePct: energyOffsetPct ?? 0,
    panelCount: panelCount ?? 0,
    usablePctRoof: usableRoofPct ?? 0,
  });
  const confidence = getPdfConfidenceLabel(suitabilityScore);
  const calculatedLeadScore = calculateLeadScore({
    annualSavings,
    email: lead.email,
    energyOffsetPct,
    monthlyBill,
    name: lead.name,
    panelCount,
    pdfDownloaded: true,
    pdfGenerated: lead.pdf_generated ?? true,
    phone: lead.phone,
    quoteRequested: lead.quote_requested,
    roofAreaM2: positiveNumber(lead.roof_area_m2),
    selectedPanelBrand: lead.selected_panel_brand,
    selectedPanelModel: lead.selected_panel_model,
    selectedPanelWatts: lead.selected_panel_watts,
    solarSuitabilityScore: lead.solar_suitability_score ?? suitabilityScore,
    systemSizeKw: systemKw,
    twentyYearSavings: lead.twenty_year_savings ?? twentyYearSavings,
    utilityBillUploaded: lead.utility_bill_uploaded,
  });
  const storedLeadScore =
    lead.lead_score === null || lead.lead_score === undefined
      ? null
      : Number(lead.lead_score);
  const leadScore = storedLeadScore !== null && Number.isFinite(storedLeadScore)
    ? Math.max(Math.round(storedLeadScore), calculatedLeadScore.score)
    : calculatedLeadScore.score;
  const advisor = buildSolarAdvisorProfile({
    annualSavings: annualSavings ?? 0,
    annualSunlightHours: sunlightHours ?? 0,
    coveragePct: energyOffsetPct ?? 0,
    grossRoofAreaM2: positiveNumber(lead.roof_area_m2),
    monthlyBill,
    panelCount: panelCount ?? 0,
    paybackYears: roiYears,
    roofSegments: snapshotAnalysis?.roofSegments ?? [],
    suitabilityScore,
    systemKw: systemKw ?? 0,
    usablePctRoof: usableRoofPct ?? 0,
    usableRoofAreaM2: positiveNumber(lead.usable_area_m2) ?? 0,
  });

  if (sunlightHours === undefined) {
    advisor.sunlightQuality = {
      label: "Unavailable",
      score: 0,
      source: "Estimated",
      segments: [],
      summary: "Sunlight data was not saved. Missing data does not mean poor sunlight; run a new analysis and verify shade with an installer.",
    };
    advisor.suitability.limitingFactors = advisor.suitability.limitingFactors.filter(
      (factor) => factor !== "Lower usable sunlight may reduce production."
    );
    advisor.suitability.limitingFactors.unshift("Sunlight data requires a new analysis.");
  }
  if (!reportSnapshot) {
    advisor.summary = "This report preserves the estimates saved with your request. Detailed roof geometry was not saved, so roof fit, panel placement and sunlight quality cannot be confirmed here. Run a new analysis before comparing installation options. Final design, pricing and savings require installer verification.";
    advisor.suitability.headline = "Saved readiness estimate";
    advisor.suitability.positiveFactors = ["Previously saved estimates remain available for reference."];
    advisor.suitability.limitingFactors = [
      "Saved roof geometry and sunlight data are unavailable.",
      "A new roof analysis and installer review are required.",
    ];
  }

  return {
    id: lead.id,
    name: formatName(lead.name) || "Homeowner",
    address: lead.address || "Address unavailable",
    email: lead.email || "Email unavailable",
    phone: lead.phone || "Phone unavailable",
    lat: finiteCoordinate(reportSnapshot?.home?.lat ?? lead.lat, "lat"),
    lng: finiteCoordinate(reportSnapshot?.home?.lng ?? lead.lng, "lng"),
    generatedDate: new Date(lead.created_at || Date.now()).toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric", year: "numeric" }
    ),
    confidence,
    systemKwSource: reportSnapshot?.panelCount
      ? "Modeled from panel layout"
      : "Modeled",
    monthlyBill,
    annualSavings,
    monthlySavings,
    twentyYearSavings,
    panelCount,
    systemKw,
    annualKwh,
    energyOffsetPct,
    annualImpactLbs,
    roiYears: roiYears && roiYears > 0 ? roiYears : undefined,
    grossPaybackYears:
      grossPaybackYears && grossPaybackYears > 0 ? grossPaybackYears : undefined,
    netPaybackYears:
      netPaybackYears && netPaybackYears > 0 ? netPaybackYears : undefined,
    leadScore,
    leadScoreLabel: normalizeLeadScoreLabel(lead.lead_score_label, leadScore),
    quoteRequested: Boolean(lead.quote_requested),
    utilityBillUploaded: Boolean(lead.utility_bill_uploaded),
    selectedPanelBrand: lead.selected_panel_brand ?? undefined,
    selectedPanelModel: lead.selected_panel_model ?? undefined,
    selectedPanelWatts: positiveNumber(lead.selected_panel_watts),
    panelSizeLabel: buildPanelSizeLabel(positiveNumber(lead.selected_panel_watts)),
    roofAreaSqFt,
    usableAreaSqFt,
    usableRoofPct,
    roofPitchDeg: nonNegativeNumber(snapshotMetrics?.avgPitchDeg ?? lead.roof_pitch_deg),
    sunlightHours,
    suitabilityScore,
    suitabilityLabel: getHomeownerSuitabilityLabel(suitabilityScore),
    installedCost,
    costWithoutSolar20Yr,
    costWithSolar20Yr,
    advisor,
    reportSnapshot,
    roofIllustration: buildReportRoofIllustration(reportSnapshot),
  };
}

function drawExecutiveSummary(
  page: PDFPage,
  proposal: ProposalData,
  assets: PdfAssets,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "EXECUTIVE SUMMARY", proposal, fonts, colors);

  page.drawText("Your Solar Readiness Report", {
    x: 42,
    y: 700,
    size: 29,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(APP_REPORT_NAME, {
    x: 42,
    y: 678,
    size: 9.5,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText("Satellite-based roof analysis, savings estimate, and readiness summary", {
    x: 42,
    y: 661,
    size: 11,
    font: fonts.regular,
    color: colors.muted,
  });

  drawCard(page, 42, 514, 528, 130, colors);
  page.drawText("PREPARED FOR", { x: 58, y: 625, size: 7.8, font: fonts.bold, color: colors.cyan });
  const nameLines = drawFittedTextBlock(page, proposal.name, 58, 605, 318, 2, fonts.bold, 16, 11, 18, colors.text);
  drawFittedTextBlock(page, proposal.address, 58, 605 - nameLines * 18 - 9, 318, 4, fonts.regular, 10.2, 8.5, 12, colors.muted);
  page.drawLine({ start: { x: 392, y: 532 }, end: { x: 392, y: 628 }, thickness: 0.6, color: colors.line });
  page.drawText("ANALYSIS SAVED", { x: 408, y: 625, size: 7.8, font: fonts.bold, color: colors.muted });
  drawFittedTextBlock(page, proposal.generatedDate, 408, 607, 144, 1, fonts.bold, 10.5, 8, 12, colors.text);
  page.drawText("PRELIMINARY READINESS", { x: 408, y: 579, size: 7, font: fonts.bold, color: colors.muted });
  page.drawText(`${proposal.suitabilityScore}/100`, { x: 408, y: 551, size: 25, font: fonts.bold, color: colors.cyan });
  drawFittedTextBlock(page, proposal.suitabilityLabel, 408, 533, 144, 1, fonts.bold, 9, 8, 11, colors.green);

  drawRoofVisual(page, 42, 255, 528, 245, proposal, assets.roofImage, assets.roofImageViewport, fonts, colors, {
    compact: false,
    visualization: "panels",
  });
  drawRoofVisualCaption(page, 42, 243, 528, proposal, fonts, colors, "panels");

  const primaryMetrics = [
    {
      label: "Annual savings",
      value: formatMoneyMaybe(proposal.annualSavings),
      source: "Modeled" as SourceLabel,
      accent: colors.gold,
    },
    {
      label: "System size",
      value: formatKwMaybe(proposal.systemKw),
      source: proposal.systemKwSource,
      accent: colors.cyan,
    },
    {
      label: "Estimated energy offset",
      value: formatPctMaybe(proposal.energyOffsetPct),
      source: "User-adjusted" as SourceLabel,
      accent: colors.green,
    },
  ];
  primaryMetrics.forEach((metric, index) => {
    drawMetricCard(page, 42 + index * 182, 127, 164, 82, metric.label, metric.value, metric.source, metric.accent, fonts, colors);
  });
  drawCard(page, 42, 62, 528, 53, colors);
  page.drawText("How to read this report", {
    x: 60,
    y: 98,
    size: 10,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.utilityBillUploaded
      ? "Saved roof data, modeled savings and your submitted bill support this preliminary estimate. Final design, pricing, incentives and savings require installer verification."
      : "Saved roof data and modeled savings support this preliminary estimate. Final design, pricing, incentives and savings require installer verification.",
    60,
    82,
    490,
    fonts.regular,
    8.2,
    10.4,
    colors.muted
  );
}

async function markPdfDownloaded(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  leadId: string,
  proposal: ProposalData
) {
  try {
    await supabase
      .from("leads")
      .update({
        lead_score: proposal.leadScore,
        lead_score_label: proposal.leadScoreLabel,
        pdf_downloaded: true,
        pdf_generated: true,
      })
      .eq("id", leadId)
      .abortSignal(AbortSignal.timeout(2_000))
      .retry(false);
  } catch (error) {
    console.error("[pdf-downloaded-score]", error);
  }
}

function drawRoofAnalysisPage(
  page: PDFPage,
  proposal: ProposalData,
  assets: PdfAssets,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "ROOF ANALYSIS", proposal, fonts, colors);

  page.drawText("Your Roof Analysis", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Roof imagery, usable area, and modeled panel capacity are organized to explain the preliminary solar opportunity for this home. Final panel placement may change after installer site review.",
    42,
    674,
    492,
    fonts.regular,
    10.2,
    13.2,
    colors.muted
  );

  drawRoofVisual(page, 42, 316, 528, 286, proposal, assets.roofImage, assets.roofImageViewport, fonts, colors, {
    compact: false,
    showLegend: true,
  });
  drawRoofVisualCaption(page, 42, 296, 528, proposal, fonts, colors, "roof");

  drawCard(page, 42, 182, 258, 96, colors);
  drawPanelSummary(page, 58, 254, proposal, fonts, colors);
  drawCard(page, 312, 182, 258, 96, colors);
  drawRoofSummary(page, 328, 254, proposal, fonts, colors);

  drawCard(page, 42, 64, 528, 104, colors);
  page.drawText("AI Solar Advisor", {
    x: 60,
    y: 142,
    size: 13.5,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 448, 138, "Estimated", fonts, colors);
  drawTextBlock(
    page,
    proposal.advisor.summary,
    60,
    120,
    492,
    fonts.regular,
    8.4,
    10.6,
    colors.muted
  );
}

function drawSolarReadinessPage(
  page: PDFPage,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "SOLAR READINESS", proposal, fonts, colors);

  page.drawText("Solar Readiness", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Use this preliminary readiness score as a starting point, not a guarantee of suitability. Review the saved roof fit, sunlight, system size and estimated bill offset together with an installer.",
    42,
    674,
    492,
    fonts.regular,
    9.6,
    12.2,
    colors.muted
  );

  drawCard(page, 42, 466, 220, 150, colors, colors.cyan);
  page.drawText("Solar Readiness Score", {
    x: 62,
    y: 584,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(`${proposal.suitabilityScore}/100`, {
    x: 62,
    y: 532,
    size: 42,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText(proposal.suitabilityLabel, {
    x: 62,
    y: 506,
    size: 12,
    font: fonts.bold,
    color: colors.green,
  });
  drawSourceBadge(page, 62, 480, "Modeled", fonts, colors);

  drawCard(page, 286, 466, 284, 150, colors);
  page.drawText("What drives the score", {
    x: 306,
    y: 584,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  const readinessFactors = [
    `Energy offset: ${formatPctMaybe(proposal.energyOffsetPct)}`,
    `Accepted panel count: ${proposal.panelCount ?? "Unavailable"}`,
    `Solar-ready area: ${formatSqFtMaybe(proposal.usableAreaSqFt)}`,
    `Sunlight quality: ${proposal.advisor.sunlightQuality.label}`,
  ];
  readinessFactors.forEach((factor, index) =>
    drawBullet(page, 306, 558 - index * 24, factor, fonts, colors, 8.2)
  );

  drawCard(page, 42, 246, 528, 176, colors);
  page.drawText(proposal.advisor.suitability.headline, {
    x: 60,
    y: 392,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText("Positive factors", {
    x: 60,
    y: 360,
    size: 9,
    font: fonts.bold,
    color: colors.green,
  });
  proposal.advisor.suitability.positiveFactors.slice(0, 3).forEach((reason, index) => {
    drawBullet(page, 62, 336 - index * 22, reason, fonts, colors, 7.7, 220);
  });
  page.drawText("Installer verification items", {
    x: 320,
    y: 360,
    size: 9,
    font: fonts.bold,
    color: colors.gold,
  });
  proposal.advisor.suitability.limitingFactors.slice(0, 3).forEach((reason, index) => {
    drawBullet(page, 322, 336 - index * 22, reason, fonts, colors, 7.7, 220);
  });

  drawDisclaimer(page, 42, 150, fonts, colors);
}

function drawPanelLayoutPage(
  page: PDFPage,
  proposal: ProposalData,
  assets: PdfAssets,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "PANEL LAYOUT", proposal, fonts, colors);

  page.drawText("Panel Layout", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Panels are modeled from accepted roof candidates and translated into a clean installer-style layout. The final layout may change after fire setbacks, roof condition, electrical design, and field measurements are confirmed.",
    42,
    674,
    492,
    fonts.regular,
    9.6,
    12.2,
    colors.muted
  );

  drawRoofVisual(page, 42, 318, 528, 286, proposal, assets.roofImage, assets.roofImageViewport, fonts, colors, {
    showLegend: true,
    visualization: "panels",
  });
  drawRoofVisualCaption(page, 42, 298, 528, proposal, fonts, colors, "panels");

  drawMetricCard(
    page,
    42,
    194,
    120,
    84,
    "Accepted panels",
    proposal.panelCount !== undefined ? `${proposal.panelCount}` : "Unavailable",
    "Solar API",
    colors.cyan,
    fonts,
    colors
  );
  drawPanelSizeCard(page, 174, 186, 120, 92, proposal, fonts, colors);
  drawMetricCard(
    page,
    306,
    194,
    120,
    84,
    "System size",
    formatKwMaybe(proposal.systemKw),
    proposal.systemKwSource,
    colors.green,
    fonts,
    colors
  );
  drawMetricCard(
    page,
    438,
    194,
    132,
    84,
    "Module",
    getPanelDisplayName(proposal),
    "Modeled",
    colors.gold,
    fonts,
    colors
  );

  drawCard(page, 42, 70, 528, 100, colors);
  page.drawText("Selected equipment", {
    x: 60,
    y: 142,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  drawFittedTextBlock(page,
    [proposal.selectedPanelBrand, proposal.selectedPanelModel].filter(Boolean).join(" / ") || "Equipment details were not saved.",
    60, 122, 492, 2, fonts.bold, 10.5, 8.2, 13, colors.cyan);
  drawTextBlock(
    page,
    proposal.panelCount && proposal.systemKw
      ? `${proposal.panelCount} selected panels / ${formatKwMaybe(proposal.systemKw)}. Confirm module availability, final placement, setbacks and inverter selection with your installer.`
      : "Panel count, system size and equipment selection require a new analysis and installer verification.",
    60,
    90,
    492,
    fonts.regular,
    8.5,
    11,
    colors.muted
  );
}

function drawSunlightAnalysisPage(
  page: PDFPage,
  proposal: ProposalData,
  assets: PdfAssets,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "SUNLIGHT ANALYSIS", proposal, fonts, colors);

  page.drawText("Sunlight Analysis", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Review the saved sunlight estimate alongside the roof context. This PDF does not include a measured sunlight heat map. Roof direction, pitch, nearby trees and seasonal shade still require installer review.",
    42,
    674,
    492,
    fonts.regular,
    9.6,
    12.2,
    colors.muted
  );

  drawRoofVisual(page, 42, 308, 528, 284, proposal, assets.roofImage, assets.roofImageViewport, fonts, colors, {
    showLegend: true,
    visualization: "sunlight",
  });
  drawRoofVisualCaption(page, 42, 284, 528, proposal, fonts, colors, "sunlight");

  drawCard(page, 42, 164, 250, 104, colors);
  page.drawText("Sunlight quality", {
    x: 60,
    y: 236,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(proposal.advisor.sunlightQuality.label, {
    x: 60,
    y: 208,
    size: 22,
    font: fonts.bold,
    color: proposal.sunlightHours === undefined
      ? colors.muted
      : getSunlightPdfColor(proposal.advisor.sunlightQuality.label, colors),
  });
  drawSourceBadge(page, 60, 182, proposal.advisor.sunlightQuality.source, fonts, colors);

  drawCard(page, 314, 164, 256, 104, colors);
  page.drawText("Roof exposure", {
    x: 332,
    y: 236,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.sunlightHours
      ? `${formatNumber(proposal.sunlightHours)} modeled annual sunlight hours are used with the accepted panel layout to estimate production. Exposure depends on roof direction, pitch, shade, and nearby obstructions.`
      : "Detailed sunlight hours were not saved. Any recorded estimates are shown separately; run a new analysis to check roof exposure.",
    332,
    214,
    210,
    fonts.regular,
    8.3,
    10.7,
    colors.muted
  );

  drawCard(page, 42, 58, 528, 92, colors);
  page.drawText("How to interpret the estimate", {
    x: 60,
    y: 122,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.advisor.sunlightQuality.summary,
    60,
    102,
    492,
    fonts.regular,
    8.4,
    10.8,
    colors.muted
  );
}

function drawSavingsPage(
  page: PDFPage,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "SAVINGS & ENERGY", proposal, fonts, colors);

  page.drawText("Estimated Energy Impact", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 42, 670, "Modeled", fonts, colors);
  drawTextBlock(
    page,
    "Savings and energy values are modeled using Arizona electricity assumptions and the available roof estimate. They are not a utility guarantee.",
    116,
    678,
    414,
    fonts.regular,
    9.8,
    12.5,
    colors.muted
  );

  drawMetricCard(
    page,
    42,
    570,
    120,
    82,
    "Annual savings",
    formatMoneyMaybe(proposal.annualSavings),
    "Modeled",
    colors.gold,
    fonts,
    colors
  );
  drawMetricCard(
    page,
    174,
    570,
    120,
    82,
    "Monthly savings",
    formatMoneyMaybe(proposal.monthlySavings),
    "Modeled",
    colors.cyan,
    fonts,
    colors
  );
  drawMetricCard(
    page,
    306,
    570,
    120,
    82,
    "Energy offset",
    formatPctMaybe(proposal.energyOffsetPct),
    "User-adjusted",
    colors.green,
    fonts,
    colors
  );
  drawMetricCard(
    page,
    438,
    570,
    132,
    82,
    (proposal.twentyYearSavings ?? 0) < 0 ? "20-year net loss" : "20-year net savings",
    formatMoneyMaybe(proposal.twentyYearSavings),
    "Modeled",
    colors.orange,
    fonts,
    colors
  );

  drawCard(page, 42, 326, 528, 202, colors);
  page.drawText("With Solar vs Without Solar", {
    x: 60,
    y: 500,
    size: 14.5,
    font: fonts.bold,
    color: colors.text,
  });
  drawCostComparison(page, 70, 366, 452, 100, proposal, fonts, colors);

  drawCard(page, 42, 186, 252, 110, colors);
  page.drawText("Estimated production", {
    x: 58,
    y: 264,
    size: 9.2,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(formatKwhMaybe(proposal.annualKwh), {
    x: 58,
    y: 236,
    size: 23,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Annual production varies with shading, roof angle, weather, equipment choice, and final design.",
    58,
    218,
    210,
    fonts.regular,
    8.8,
    11.4,
    colors.muted
  );

  drawCard(page, 318, 186, 252, 110, colors);
  page.drawText("Environmental impact", {
    x: 334,
    y: 264,
    size: 9.2,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(formatLbsMaybe(proposal.annualImpactLbs), {
    x: 334,
    y: 236,
    size: 23,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Estimated annual carbon dioxide avoided from the modeled production profile.",
    334,
    218,
    210,
    fonts.regular,
    8.8,
    11.4,
    colors.muted
  );

  drawDisclaimer(page, 42, 122, fonts, colors);
}

function drawFinancingPage(
  page: PDFPage,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "FINANCING OPTIONS", proposal, fonts, colors);

  page.drawText("Ways to Go Solar", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "These options are illustrative. Final pricing, incentives, loan terms, and utility policy need confirmation from a licensed installer or lender.",
    42,
    674,
    480,
    fonts.regular,
    9.8,
    12.5,
    colors.muted
  );

  drawFinanceOption(
    page,
    42,
    472,
    164,
    "Cash Purchase",
    "Pay in full and own your system outright. Highest long-term savings, zero interest.",
    ["Highest ownership control", "No loan interest", "Largest upfront cost"],
    proposal.installedCost ? formatMoney(proposal.installedCost) : "Estimate unavailable",
    fonts,
    colors,
    false,
    "Upfront cost"
  );
  drawFinanceOption(
    page,
    224,
    472,
    164,
    "Solar Loan",
    "Own your system and pay over time while keeping long-term savings potential.",
    ["Lower upfront barrier", "May preserve incentives", "Depends on APR and term"],
    "Lender quote required",
    fonts,
    colors,
    true
  );
  drawFinanceOption(
    page,
    406,
    472,
    164,
    "Lease / PPA",
    "A lower-maintenance option where a provider owns or operates the system.",
    ["Low upfront cost", "Simpler ownership", "Lower lifetime upside"],
    "Provider quote required",
    fonts,
    colors
  );

  drawCard(page, 42, 176, 528, 254, colors);
  page.drawText("Estimated financing snapshot", {
    x: 60,
    y: 392,
    size: 14.5,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 420, 388, "Modeled", fonts, colors);

  const federalCreditRate = getFederalResidentialSolarCreditRate();
  const rows = [
    {
      label: "Up-front cost of installation",
      value: proposal.installedCost ? formatMoney(proposal.installedCost) : "Unavailable",
    },
    { label: "Estimated annual savings", value: formatMoneyMaybe(proposal.annualSavings) },
    {
      label: "Gross payback (before incentives)",
      value: proposal.grossPaybackYears ? `${proposal.grossPaybackYears} yrs` : "Unavailable",
    },
    {
      label: "Estimated payback after current modeled federal credit",
      primary: true,
      value: proposal.netPaybackYears ? `${proposal.netPaybackYears} yrs` : "Unavailable",
    },
    { label: "Total 20-year cost with solar", value: formatMoneyMaybe(proposal.costWithSolar20Yr) },
    { label: "Total 20-year cost without solar", value: formatMoneyMaybe(proposal.costWithoutSolar20Yr) },
    { label: (proposal.twentyYearSavings ?? 0) < 0 ? "Total 20-year net loss" : "Total 20-year net savings", value: formatMoneyMaybe(proposal.twentyYearSavings) },
  ];

  rows.forEach((row, index) => {
    const y = 356 - index * 28;
    if (row.primary) {
      page.drawRectangle({
        x: 60,
        y: y - 4,
        width: 456,
        height: 24,
        color: colors.cyan,
        opacity: 0.1,
      });
      page.drawRectangle({
        x: 60,
        y: y - 4,
        width: 3,
        height: 24,
        color: colors.cyan,
      });
      page.drawText(row.label, {
        x: 72,
        y: y + 3,
        size: 8.8,
        font: fonts.regular,
        color: colors.text,
      });
      page.drawText(row.value, {
        x: 426,
        y: y + 3,
        size: 10.2,
        font: fonts.bold,
        color: colors.cyan,
      });
      return;
    }
    page.drawLine({
      start: { x: 60, y: y + 18 },
      end: { x: 552, y: y + 18 },
      thickness: 0.5,
      color: colors.line,
      opacity: 0.55,
    });
    page.drawText(row.label, {
      x: 60,
      y,
      size: 9.8,
      font: fonts.regular,
      color: colors.muted,
    });
    page.drawText(row.value, {
      x: 420,
      y,
      size: 10.4,
      font: fonts.bold,
      color:
        row.value === "Unavailable" || row.value === "Estimate unavailable"
          ? colors.muted
          : colors.text,
    });
  });

  drawTextBlock(
    page,
    federalCreditRate > 0
      ? `The estimate models a ${Math.round(federalCreditRate * 100)}% federal residential credit. Eligibility and timing require tax-professional confirmation.`
      : "No federal residential clean-energy credit is modeled for new 2026 expenditures under current IRS guidance. Arizona credit eligibility is not deducted from payback and requires tax-professional confirmation.",
    60,
    156,
    490,
    fonts.regular,
    7.4,
    9.6,
    colors.muted
  );

  drawTextBlock(
    page,
    "Production degradation, export compensation, dealer or origination fees, and maintenance or replacement reserves are not modeled. Verify utility tariffs, warranties, lender terms, and long-term service costs with the installer.",
    60,
    119,
    490,
    fonts.regular,
    7.4,
    9.6,
    colors.muted
  );

  drawDisclaimer(page, 42, 50, fonts, colors);
}

function drawAiSolarAdvisorPage(
  page: PDFPage,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "AI SOLAR ADVISOR", proposal, fonts, colors);

  page.drawText("AI Solar Advisor", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "A plain-English interpretation of the roof model, savings estimate, and next decision points. This summary is deterministic and based only on the saved report data.",
    42,
    674,
    492,
    fonts.regular,
    9.5,
    12,
    colors.muted
  );

  drawCard(page, 42, 486, 528, 142, colors, colors.cyan);
  page.drawText("Personalized summary", {
    x: 60,
    y: 600,
    size: 14,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 438, 600, "Estimated", fonts, colors);
  drawTextBlock(
    page,
    proposal.advisor.summary,
    60,
    578,
    492,
    fonts.regular,
    8.6,
    11,
    colors.muted
  );

  drawCard(page, 42, 292, 250, 154, colors);
  page.drawText("Key takeaways", {
    x: 60,
    y: 416,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  [
    proposal.panelCount && proposal.systemKw
      ? `${proposal.panelCount} accepted panels for a modeled ${formatKwMaybe(proposal.systemKw)} system.`
      : "Detailed panel count and system size are unavailable in this saved report.",
    proposal.annualSavings !== undefined
      ? `${formatMoneyMaybe(proposal.annualSavings)} estimated annual savings from the saved bill input.`
      : "Annual savings were not saved in this report.",
    proposal.energyOffsetPct !== undefined
      ? `${formatPctMaybe(proposal.energyOffsetPct)} estimated energy offset from modeled production.`
      : "Energy offset is unavailable in this saved report.",
    `Sunlight quality is ${proposal.advisor.sunlightQuality.label.toLowerCase()}.`,
  ].forEach((item, index) => drawBullet(page, 60, 392 - index * 28, item, fonts, colors, 7.8, 210));

  drawCard(page, 320, 292, 250, 154, colors);
  page.drawText("Homeowner questions", {
    x: 338,
    y: 416,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  proposal.advisor.questions.slice(0, 4).forEach((question, index) => {
    page.drawText(question.question, {
      x: 338,
      y: 392 - index * 28,
      size: 8.4,
      font: fonts.bold,
      color: colors.cyan,
    });
  });

  drawCard(page, 42, 104, 528, 150, colors);
  page.drawText("Most important limitation", {
    x: 60,
    y: 226,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.advisor.disclaimer,
    60,
    204,
    492,
    fonts.regular,
    9,
    12,
    colors.muted
  );
  drawTextBlock(
    page,
    "Use this report to decide whether the roof and savings look worth a final installer review. It should not be treated as a final engineering plan or a guaranteed utility bill outcome.",
    60,
    158,
    492,
    fonts.regular,
    8.4,
    11,
    colors.muted
  );
}

function drawNextStepsPage(
  page: PDFPage,
  proposal: ProposalData,
  assets: PdfAssets,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "NEXT STEPS", proposal, fonts, colors);

  page.drawText("What Happens Next?", {
    x: 42,
    y: 698,
    size: 28,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Use this report to review your solar options and discuss final design, pricing, incentives, and installation details with a licensed installer.",
    42,
    672,
    440,
    fonts.regular,
    10.2,
    13.2,
    colors.muted
  );

  drawStep(page, 42, 560, "1", "Review your report", "Confirm that the modeled savings, roof area, and panel count look aligned with your goals.", fonts, colors);
  drawStep(page, 42, 450, "2", "Request a final installer review", "A licensed installer can verify roof condition, setbacks, electrical requirements, incentives, and final pricing.", fonts, colors);
  drawStep(page, 42, 340, "3", "Decide when you're ready", "Use this report as a starting point for a no-pressure solar conversation.", fonts, colors);

  drawCard(page, 338, 288, 232, 370, colors);
  page.drawText("Next Step", {
    x: 356,
    y: 630,
    size: 13.5,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 356, 604, proposal.quoteRequested ? "Requested" : "Next Step", fonts, colors);
  page.drawText("Request Final Review", {
    x: 356,
    y: 582,
    size: 11.4,
    font: fonts.bold,
    color: colors.cyan,
  });
  drawTextBlock(
    page,
    proposal.quoteRequested
      ? "Your review request was received. A solar specialist can follow up with this report context."
      : "Use this report to discuss final design and pricing with a licensed installer.",
    356,
    560,
    182,
    fonts.regular,
    8.8,
    11.3,
    colors.muted
  );
  drawContactRow(page, 356, 512, "Report recipient", proposal.email, fonts, colors);
  drawContactRow(page, 356, 466, "Report ID", proposal.id.slice(0, 8).toUpperCase(), fonts, colors);
  drawContactRow(page, 356, 420, "Website", new URL(APP_CANONICAL_URL).hostname, fonts, colors);

  drawTextBlock(page, "Reopen address analysis", 356, 364, 96, fonts.bold, 9.2, 12, colors.muted);
  drawTextBlock(page, "Scan to start a new estimate for this address.", 356, 329, 96, fonts.regular, 7.8, 10, colors.muted);
  if (assets.qrImage) {
    page.drawRectangle({ x: 461, y: 302, width: 92, height: 92, color: rgb(1, 1, 1) });
    page.drawImage(assets.qrImage, { x: 466, y: 307, width: 82, height: 82 });
  } else {
    drawCard(page, 461, 302, 92, 92, colors);
    page.drawText("QR unavailable", {
      x: 468,
      y: 344,
      size: 8,
      font: fonts.bold,
      color: colors.muted,
    });
  }
  drawCard(page, 42, 88, 528, 196, colors);
  page.drawText("Why this is an estimate", {
    x: 60,
    y: 258,
    size: 11,
    font: fonts.bold,
    color: colors.text,
  });
  const notes = [
    "Satellite imagery may not show recent roof changes, tree trimming, or new obstructions.",
    "Final panel placement depends on setbacks, fire code, roof condition, electrical service, and installer measurements.",
    "Savings depend on utility rates, usage, financing, incentives, and future energy costs.",
    "This is a preliminary estimate, not a binding installation contract.",
  ];
  notes.forEach((note, index) => drawBullet(page, 62, 230 - index * 28, note, fonts, colors, 7.7, 486));
}

function drawInstallerVerificationPage(
  page: PDFPage,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawPageShell(page, "INSTALLER VERIFICATION", proposal, fonts, colors);

  page.drawText("Installer Verification", {
    x: 42,
    y: 698,
    size: 27,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    "Before making a solar purchase decision, a licensed installer should confirm roof, electrical, incentive, and utility details. This checklist keeps the estimate useful while being clear about what still needs professional review.",
    42,
    674,
    492,
    fonts.regular,
    9.6,
    12.2,
    colors.muted
  );

  const verificationGroups = [
    {
      title: "Roof and layout",
      items: [
        "Roof age, condition, material, and structural capacity.",
        "Final fire setbacks, access pathways, vents, skylights, and obstructions.",
        "Exact panel layout, attachment points, and roof plane measurements.",
      ],
    },
    {
      title: "Electrical and utility",
      items: [
        "Main service panel capacity and interconnection requirements.",
        "Current utility rate plan, export credit rules, and net billing details.",
        "Battery backup or inverter choice if shading or backup needs are present.",
      ],
    },
    {
      title: "Pricing and incentives",
      items: [
        "Final equipment pricing, labor, permits, and financing terms.",
        "Federal tax credit eligibility and Arizona incentive applicability.",
        "Production guarantee, workmanship warranty, and monitoring details.",
      ],
    },
  ];

  verificationGroups.forEach((group, index) => {
    const x = 42 + index * 176;
    drawCard(page, x, 314, 160, 300, colors);
    page.drawText(group.title, {
      x: x + 14,
      y: 584,
      size: 11,
      font: fonts.bold,
      color: colors.text,
    });
    drawVerificationItems(page, x + 14, 552, 128, group.items, fonts, colors);
  });

  drawCard(page, 42, 110, 528, 152, colors, colors.gold);
  page.drawText("Final confirmation", {
    x: 60,
    y: 238,
    size: 14,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.panelCount && proposal.systemKw
      ? `This report is a strong starting point for ${proposal.address}. The saved model shows ${proposal.panelCount} accepted panels, ${formatKwMaybe(proposal.systemKw)} system size, ${formatMoneyMaybe(proposal.annualSavings)} estimated annual savings, and ${formatPctMaybe(proposal.energyOffsetPct)} energy offset. Final design may change after installer verification.`
      : `This report preserves the saved estimates for ${proposal.address}. Some detailed roof and system information is unavailable. Missing figures are marked unavailable, not treated as zero. Final design requires a new analysis and installer verification.`,
    60,
    214,
    492,
    fonts.regular,
    9,
    12,
    colors.muted
  );
  drawSourceBadge(page, 60, 126, "Modeled", fonts, colors);
  drawSourceBadge(page, 130, 126, "Installer Verification Required", fonts, colors, 150);
}

function drawPageShell(
  page: PDFPage,
  section: string,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  const width = page.getWidth();
  const height = page.getHeight();

  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.bg });
  page.drawCircle({ x: 488, y: 694, size: 130, color: colors.cyan, opacity: 0.08 });
  page.drawCircle({ x: 94, y: 118, size: 160, color: colors.gold, opacity: 0.05 });
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: colors.line, borderWidth: 0.8, color: colors.shell, opacity: 0.9 });

  page.drawText(APP_NAME.toUpperCase(), {
    x: 42,
    y: 744,
    size: 10,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText(section, {
    x: 428,
    y: 744,
    size: 8,
    font: fonts.bold,
    color: colors.muted,
  });
  drawFittedTextBlock(page, proposal.address, 42, 42, 390, 1, fonts.regular, 7.5, 6.5, 9, colors.muted);
  page.drawText(`Report ${proposal.id.slice(0, 8).toUpperCase()}`, {
    x: 454,
    y: 42,
    size: 7.5,
    font: fonts.bold,
    color: colors.muted,
  });
}

function drawRoofVisual(
  page: PDFPage, x: number, y: number, width: number, height: number,
  proposal: ProposalData, image: PDFImage | null, _imageViewport: RoofImageViewport | null,
  fonts: PdfFonts, colors: PdfColors,
  options: { compact?: boolean; showLegend?: boolean; visualization?: "roof" | "panels" | "sunlight" } = {}
) {
  const mode = options.visualization ?? "roof";
  const model = proposal.roofIllustration;
  const useModel = model.available && (mode === "panels" || !image);
  drawCard(page, x, y, width, height, colors);
  page.drawText(useModel ? "3D ROOF ILLUSTRATION" : "SATELLITE ROOF CONTEXT", {
    x: x + 18, y: y + height - 23, size: 9, font: fonts.bold, color: colors.cyan,
  });
  const detail = useModel
    ? mode === "panels"
      ? `${model.renderedPanelCount} placements shown / ${proposal.panelCount ?? 0} selected  |  ${formatKwMaybe(proposal.systemKw)}`
      : "Saved roof planes  |  Approximate height"
    : "Property context only; not an installation drawing";
  drawFittedTextBlock(page, detail, x + 18, y + height - 39, width - 36, 1, fonts.regular, 8.5, 7, 10, colors.muted);
  const frame = { x: x + 18, y: y + 22, width: width - 36, height: height - 76 };
  if (useModel && model.extents) {
    const extents = model.extents;
    const scale = Math.min(frame.width / extents.width, frame.height / extents.height) * 0.94;
    const offsetX = frame.x + (frame.width - extents.width * scale) / 2;
    const offsetY = frame.y + (frame.height - extents.height * scale) / 2;
    for (const polygon of model.projectedPolygons) {
      if (mode !== "panels" && polygon.kind === "panel") continue;
      const points = polygon.points.map((point) => [
        offsetX + (point.x - extents.minX) * scale,
        offsetY + (point.y - extents.minY) * scale,
      ]);
      drawPolygon(page, points, pdfHexColor(polygon.fill), 1, pdfHexColor(polygon.stroke), polygon.kind === "panel" ? 0.45 : 0.55);
      if (polygon.kind === "panel" && points.length === 4) {
        // Cell lines stay in the same perspective quadrilateral as each module.
        for (const t of [0.25, 0.5, 0.75]) {
          const from = interpolatePoint(points[0], points[1], t);
          const to = interpolatePoint(points[3], points[2], t);
          page.drawLine({ start: from, end: to, thickness: 0.2, color: rgb(0.35, 0.49, 0.61), opacity: 0.6 });
        }
      }
    }
    page.drawText("Roof height is approximate. Not an elevation scan or engineering plan.", {
      x: x + 18, y: y + 9, size: 7, font: fonts.regular, color: colors.muted,
    });
  } else if (image) {
    drawRoofBaseImage(page, image, frame, colors);
  } else {
    drawFittedTextBlock(page, "Roof visual unavailable", x + 24, y + height / 2 + 10, width - 48, 1, fonts.bold, 16, 12, 18, colors.text);
    drawTextBlock(page, "This saved report has no usable roof geometry or imagery. Your saved estimate remains below; start a new analysis to refresh the roof view.",
      x + 24, y + height / 2 - 14, width - 48, fonts.regular, 9.5, 13, colors.muted);
  }
}

function pdfHexColor(hex: string) {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function interpolatePoint(a: number[], b: number[], t: number) {
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
}

function drawRoofBaseImage(
  page: PDFPage,
  image: PDFImage,
  frame: { x: number; y: number; width: number; height: number },
  colors: PdfColors
) {
  // Contain instead of crop: keep the full roof and imagery attribution visible.
  const coverScale = Math.min(frame.width / image.width, frame.height / image.height);
  const drawnWidth = image.width * coverScale;
  const drawnHeight = image.height * coverScale;
  const drawX = frame.x + (frame.width - drawnWidth) / 2;
  const drawY = frame.y + (frame.height - drawnHeight) / 2;

  page.pushOperators(
    pushGraphicsState(),
    clippingRectangle(frame.x, frame.y, frame.width, frame.height),
    clip(),
    endPath()
  );
  page.drawImage(image, {
    x: drawX,
    y: drawY,
    width: drawnWidth,
    height: drawnHeight,
    opacity: 0.96,
  });
  page.pushOperators(popGraphicsState());

  page.drawRectangle({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    color: colors.bg,
    opacity: 0.08,
  });
  page.drawRectangle({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    borderColor: colors.line,
    borderWidth: 0.7,
    opacity: 0.9,
  });
}

function drawPanelSummary(
  page: PDFPage,
  x: number,
  y: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  page.drawText("Accepted panel count", {
    x,
    y,
    size: 8,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(
    proposal.panelCount ? `${proposal.panelCount} modules` : "Estimate unavailable",
    {
      x,
      y: y - 25,
      size: 18,
      font: fonts.bold,
      color: proposal.panelCount ? colors.text : colors.muted,
    }
  );
  drawSourceBadge(page, x, y - 48, "Solar API", fonts, colors);
}

function drawRoofSummary(
  page: PDFPage,
  x: number,
  y: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  page.drawText("Roof suitability", {
    x,
    y,
    size: 8,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(
    proposal.usableAreaSqFt
      ? `${formatNumber(Math.round(proposal.usableAreaSqFt))} sq ft solar-ready`
      : "Estimate unavailable",
    {
      x,
      y: y - 25,
      size: 15,
      font: fonts.bold,
      color: proposal.usableAreaSqFt ? colors.text : colors.muted,
    }
  );
  const pitch = hasFiniteValue(proposal.roofPitchDeg)
    ? `${Number(proposal.roofPitchDeg.toFixed(1))} deg roof pitch`
    : "Roof pitch unavailable";
  page.drawText(pitch, {
    x,
    y: y - 44,
    size: 8.5,
    font: fonts.regular,
    color: colors.muted,
  });
  page.drawText(`Suitability ${proposal.suitabilityScore}/100`, {
    x,
    y: y - 62,
    size: 8.5,
    font: fonts.bold,
    color: colors.cyan,
  });
}

function drawCostComparison(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  const withoutSolar = proposal.costWithoutSolar20Yr;
  const withSolar = proposal.costWithSolar20Yr;
  if (!withoutSolar || !withSolar) {
    page.drawText("Cost projection unavailable", {
      x,
      y: y + height / 2,
      size: 15,
      font: fonts.bold,
      color: colors.muted,
    });
    return;
  }

  const max = Math.max(withoutSolar, withSolar);
  const rows = [
    { label: "Without solar", value: withoutSolar, color: colors.slate },
    { label: "With solar", value: withSolar, color: colors.cyan },
  ];

  rows.forEach((row, index) => {
    const rowY = y + height - 28 - index * 42;
    page.drawText(row.label, {
      x,
      y: rowY + 5,
      size: 9,
      font: fonts.bold,
      color: colors.muted,
    });
    page.drawRectangle({
      x: x + 118,
      y: rowY,
      width: width - 205,
      height: 18,
      color: colors.line,
      opacity: 0.25,
    });
    page.drawRectangle({
      x: x + 118,
      y: rowY,
      width: ((width - 205) * row.value) / max,
      height: 18,
      color: row.color,
      opacity: 0.85,
    });
    page.drawText(formatMoney(row.value), {
      x: x + width - 76,
      y: rowY + 4,
      size: 10,
      font: fonts.bold,
      color: colors.text,
    });
  });
}

function drawFinanceOption(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  title: string,
  body: string,
  bullets: string[],
  monthlyImpact: string,
  fonts: PdfFonts,
  colors: PdfColors,
  highlighted = false,
  impactLabel = "Monthly impact"
) {
  drawCard(page, x, y, width, 170, colors, highlighted ? colors.cyan : undefined);
  page.drawText(title, {
    x: x + 14,
    y: y + 144,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(page, body, x + 14, y + 124, width - 28, fonts.regular, 8.2, 10.8, colors.muted);
  bullets.forEach((bullet, index) => {
    drawBullet(page, x + 16, y + 78 - index * 18, bullet, fonts, colors, 7.2, width - 43);
  });
  page.drawText(impactLabel, {
    x: x + 14,
    y: y + 12,
    size: 7.4,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(monthlyImpact, {
    x: x + 14,
    y: y + 25,
    size: 10.5,
    font: fonts.bold,
    color: colors.gold,
  });
}

function drawStep(
  page: PDFPage,
  x: number,
  y: number,
  number: string,
  title: string,
  body: string,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawCard(page, x, y, 270, 90, colors);
  page.drawCircle({ x: x + 28, y: y + 42, size: 16, color: colors.cyan, opacity: 0.9 });
  page.drawText(number, {
    x: x + 24,
    y: y + 37,
    size: 13,
    font: fonts.bold,
    color: colors.bg,
  });
  page.drawText(title, {
    x: x + 58,
    y: y + 54,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(page, body, x + 58, y + 35, 188, fonts.regular, 8.2, 10.6, colors.muted);
}

function drawPanelSizeCard(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawCard(page, x, y, width, height, colors);
  page.drawRectangle({ x, y: y + height - 4, width, height: 4, color: colors.blue, opacity: 0.75 });
  page.drawText("Panel size", {
    x: x + 10,
    y: y + height - 22,
    size: 7.4,
    font: fonts.bold,
    color: colors.muted,
  });
  const sizeLabel = proposal.selectedPanelWatts
    ? `${proposal.selectedPanelWatts}W`
    : proposal.panelSizeLabel.replace(/\s*module$/i, "");
  page.drawText(sizeLabel, {
    x: x + 10,
    y: y + 52,
    size: 18,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText("module", {
    x: x + 10,
    y: y + 34,
    size: 11,
    font: fonts.regular,
    color: colors.muted,
  });
  drawSourceBadge(page, x + 10, y + 12, "Modeled from panel layout", fonts, colors, width - 20);
}

function drawContactRow(
  page: PDFPage,
  x: number,
  y: number,
  label: string,
  value: string,
  fonts: PdfFonts,
  colors: PdfColors
) {
  page.drawText(label.toUpperCase(), {
    x,
    y,
    size: 7.2,
    font: fonts.bold,
    color: colors.cyan,
  });
  drawFittedTextBlock(page, value, x, y - 15, 194, 2, fonts.bold, 9.6, 7.4, 11.4, colors.text);
}

function drawMetricCard(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  source: SourceLabel,
  accent: Color,
  fonts: PdfFonts,
  colors: PdfColors
) {
  const maxValueWidth = width - 20;
  let valueFontSize = value.length > 12 ? 14.5 : 18;

  while (
    fonts.bold.widthOfTextAtSize(value, valueFontSize) > maxValueWidth &&
    valueFontSize > 7.2
  ) {
    valueFontSize -= 0.4;
  }

  drawCard(page, x, y, width, height, colors);
  page.drawRectangle({ x, y: y + height - 4, width, height: 4, color: accent, opacity: 0.75 });
  page.drawText(label, {
    x: x + 10,
    y: y + height - 22,
    size: 7.4,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(value, {
    x: x + 10,
    y: y + height - 44,
    size: valueFontSize,
    font: fonts.bold,
    color: value.toLowerCase().includes("unavailable")
      ? colors.muted
      : colors.text,
    maxWidth: maxValueWidth,
  });
  drawSourceBadge(page, x + 10, y + 10, source, fonts, colors, width - 20);
}

function drawSourceBadge(
  page: PDFPage,
  x: number,
  y: number,
  label: SourceLabel,
  fonts: PdfFonts,
  colors: PdfColors,
  maxWidth?: number
) {
  const naturalWidth = Math.max(54, label.length * 6.2 + 16);
  const width = maxWidth ? Math.min(naturalWidth, maxWidth) : naturalWidth;
  let fontSize = 6.2;
  while (fonts.bold.widthOfTextAtSize(label.toUpperCase(), fontSize) > width - 14 && fontSize > 4.4) {
    fontSize -= 0.2;
  }
  const color =
    label === "Solar API"
      ? colors.cyan
      : label === "Modeled" || label === "Modeled from panel layout"
        ? colors.gold
        : label === "Utility Bill"
          ? colors.green
        : label === "User-adjusted"
          ? colors.green
          : label === "Estimated"
            ? colors.orange
            : colors.slate;
  page.drawRectangle({
    x,
    y,
    width,
    height: 18,
    color,
    opacity: 0.15,
    borderColor: color,
    borderWidth: 0.65,
  });
  page.drawText(label.toUpperCase(), {
    x: x + 7,
    y: y + 6.2,
    size: fontSize,
    font: fonts.bold,
    color: colors.text,
  });
}

function drawRoofVisualCaption(
  page: PDFPage, x: number, y: number, width: number, proposal: ProposalData,
  fonts: PdfFonts, colors: PdfColors, visualization: "roof" | "panels" | "sunlight"
) {
  const model = proposal.roofIllustration;
  const text = visualization === "panels" && model.available
    ? model.renderedPanelCount !== proposal.panelCount
      ? "Only placements inside usable saved roof faces are shown. Missing or invalid placements are omitted; final layout requires installer verification."
      : "Saved roof planes and selected panels, shown in perspective. Heights are approximate; final layout requires installer verification."
    : visualization === "sunlight"
      ? "Roof context only, not a measured heat map. Sunlight figures below come from saved analysis; verify shade and production with an installer."
      : "Preliminary roof context from available saved data. Roof condition, usable area and measurements require installer verification.";
  drawFittedTextBlock(page, text, x, y, width, 2, fonts.regular, 8.2, 7.8, 10.4, colors.muted);
}

function drawDisclaimer(page: PDFPage, x: number, y: number, fonts: PdfFonts, colors: PdfColors) {
  drawCard(page, x, y, 528, 46, colors, colors.gold);
  drawTextBlock(
    page,
    "This is a preliminary solar estimate. Final panel placement, incentives, pricing, and savings require installer confirmation.",
    x + 16,
    y + 28,
    490,
    fonts.regular,
    8.8,
    11.4,
    colors.muted
  );
}

function drawBullet(
  page: PDFPage,
  x: number,
  y: number,
  text: string,
  fonts: PdfFonts,
  colors: PdfColors,
  size = 8.5,
  maxWidth = 470
) {
  page.drawCircle({ x: x + 3, y: y + 8 + size * 0.33, size: 2, color: colors.cyan, opacity: 0.85 });
  drawTextBlock(page, text, x + 13, y + 8, maxWidth, fonts.regular, size, size + 3, colors.muted);
}

function drawVerificationItems(
  page: PDFPage,
  x: number,
  startY: number,
  width: number,
  items: string[],
  fonts: PdfFonts,
  colors: PdfColors
) {
  let cursorY = startY;
  items.forEach((item) => {
    const lineCount = countTextLines(item, width - 14, fonts.regular, 7.5);
    drawBullet(page, x, cursorY, item, fonts, colors, 7.5, width - 14);
    cursorY -= Math.max(30, lineCount * 10 + 12);
  });
}

function drawCard(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: PdfColors,
  borderColor?: Color
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: colors.card,
    opacity: 0.96,
    borderColor: borderColor ?? colors.line,
    borderWidth: borderColor ? 1.1 : 0.85,
  });
}

function drawPolygon(
  page: PDFPage,
  points: number[][],
  fill: Color,
  opacity: number,
  border: Color,
  borderWidth: number,
  borderOpacity = 0.9
) {
  const path = points
    .map(([px, py], index) => `${index === 0 ? "M" : "L"} ${px} ${-py}`)
    .join(" ");
  page.drawSvgPath(`${path} Z`, {
    color: fill,
    opacity,
    borderColor: border,
    borderWidth,
    borderOpacity,
  });
}

function drawTextBlock(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color: Color
) {
  const lines = wrapTextLines(text, maxWidth, font, size);

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });

  return lines.length;
}

function countTextLines(text: string, maxWidth: number, font: PDFFont, size: number) {
  return wrapTextLines(text, maxWidth, font, size).length;
}

function wrapTextLines(text: string, maxWidth: number, font: PDFFont, size: number) {
  const words = sanitizePdfText(text).split(/\s+/).flatMap((word) => {
    // Emails and model identifiers can be longer than a whole line.
    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      if (chunk && font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += character;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function drawFittedTextBlock(
  page: PDFPage, text: string, x: number, y: number, width: number, maxLines: number,
  font: PDFFont, initialSize: number, minSize: number, lineHeight: number, color: Color
) {
  let size = initialSize;
  let lines = wrapTextLines(text, width, font, size);
  while (lines.length > maxLines && size > minSize) {
    size = Math.max(minSize, size - 0.25);
    lines = wrapTextLines(text, width, font, size);
  }
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let tail = visible[maxLines - 1];
    while (tail && font.widthOfTextAtSize(tail + "...", size) > width) tail = tail.slice(0, -1);
    visible[maxLines - 1] = tail.trimEnd() + "...";
  }
  visible.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size, font, color }));
  return visible.length;
}

function sanitizePdfText(text: string) {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, "")
    .replace(/[\u2600-\u27BF]/g, "")
    .replace(/\uFE0F/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createColors() {
  return {
    bg: rgb(0.015, 0.035, 0.055),
    shell: rgb(0.035, 0.07, 0.105),
    card: rgb(0.055, 0.09, 0.13),
    mapBg: rgb(0.08, 0.12, 0.13),
    text: rgb(0.94, 0.98, 1),
    muted: rgb(0.72, 0.78, 0.86),
    line: rgb(0.23, 0.31, 0.39),
    cyan: rgb(0.25, 0.86, 0.95),
    blue: rgb(0.22, 0.52, 0.96),
    green: rgb(0.25, 0.83, 0.58),
    gold: rgb(0.96, 0.72, 0.23),
    orange: rgb(0.94, 0.42, 0.16),
    slate: rgb(0.46, 0.53, 0.62),
    badgeFill: rgb(0.11, 0.17, 0.23),
  };
}

async function loadRoofImage(pdf: PDFDocument, proposal: ProposalData) {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const emptyAsset = { image: null, viewport: null } satisfies {
    image: PDFImage | null;
    viewport: RoofImageViewport | null;
  };

  if (mapsKey) {
    try {
      const snapshotViewport = proposal.reportSnapshot?.viewport;
      const snapshotCenter = proposal.reportSnapshot?.home;
      const coordinates =
        snapshotViewport?.center
          ? {
              lat: snapshotViewport.center.lat,
              lng: snapshotViewport.center.lng,
              bounds: snapshotViewport.bounds,
            }
          : snapshotCenter
            ? {
                lat: snapshotCenter.lat,
                lng: snapshotCenter.lng,
                bounds: proposal.reportSnapshot?.roofAnalysis.roofBounds ?? null,
              }
            : proposal.lat && proposal.lng
              ? { lat: proposal.lat, lng: proposal.lng, bounds: null }
              : await geocodeReportAddress(proposal.address, mapsKey);

      if (!coordinates) {
        return emptyAsset;
      }

      const viewport = getRoofAnalysisViewport({
        bounds: coordinates.bounds,
        fallbackCenter: coordinates,
        points: proposal.reportSnapshot
          ? getRoofAnalysisSnapshotPoints(
              proposal.reportSnapshot.roofAnalysis,
              proposal.reportSnapshot.home
            )
          : [coordinates],
      });
      const pdfViewport = {
        ...viewport,
        staticMapZoom: Math.min(viewport.staticMapZoom + 1, 21),
      };
      const imageViewport = {
        center: pdfViewport.center ?? coordinates,
        height: 420,
        width: 640,
        zoom: pdfViewport.staticMapZoom,
      };
      const staticMapUrl = buildRoofAnalysisStaticMapUrl({
        apiKey: mapsKey,
        height: imageViewport.height,
        viewport: pdfViewport,
        width: imageViewport.width,
      });

      if (!staticMapUrl) {
        return emptyAsset;
      }

      const response = await fetch(staticMapUrl, { signal: AbortSignal.timeout(6_000) });

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("png")) {
          return {
            image: await pdf.embedPng(bytes),
            viewport: imageViewport,
          };
        }

        return {
          image: await pdf.embedJpg(bytes),
          viewport: imageViewport,
        };
      }
    } catch {
      // The PDF should never fall back to a generic home photo.
      // A clearly labeled unavailable state is rendered instead.
    }
  }

  return emptyAsset;
}

async function geocodeReportAddress(address: string, mapsKey: string) {
  if (!address || address === "Address unavailable") {
    return null;
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", mapsKey);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      results?: Array<{
        geometry?: {
          bounds?: GoogleGeocodeBounds;
          location?: { lat?: number; lng?: number };
          viewport?: GoogleGeocodeBounds;
        };
      }>;
      status?: string;
    };
    const geometry = payload.results?.[0]?.geometry;
    const location = geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    if (payload.status !== "OK" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      bounds: toRoofGeoBounds(geometry?.bounds ?? geometry?.viewport),
    };
  } catch {
    return null;
  }
}

type GoogleGeocodeBounds = {
  northeast?: Partial<RoofViewportPoint>;
  southwest?: Partial<RoofViewportPoint>;
};

function toRoofGeoBounds(bounds?: GoogleGeocodeBounds | null) {
  const north = Number(bounds?.northeast?.lat);
  const east = Number(bounds?.northeast?.lng);
  const south = Number(bounds?.southwest?.lat);
  const west = Number(bounds?.southwest?.lng);

  if (
    !Number.isFinite(north) ||
    !Number.isFinite(east) ||
    !Number.isFinite(south) ||
    !Number.isFinite(west)
  ) {
    return null;
  }

  return {
    northeast: { lat: Math.max(north, south), lng: Math.max(east, west) },
    southwest: { lat: Math.min(north, south), lng: Math.min(east, west) },
  };
}

async function loadQrImage(pdf: PDFDocument, url: string) {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      width: 256,
      color: {
        dark: "#07111b",
        light: "#ffffff",
      },
    });
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return await pdf.embedPng(Buffer.from(base64, "base64"));
  } catch {
    return null;
  }
}

function buildEstimateUrl(address: string) {
  const url = new URL("/estimate", getPublicSiteUrl());
  url.searchParams.set("address", address);
  return url.toString();
}

function buildPdfFilename(proposal: ProposalData) {
  const safeName =
    proposal.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "homeowner";
  const date = new Date().toISOString().slice(0, 10);

  return `solar-report-${safeName}-${date}.pdf`;
}

function shouldRetryLegacySelect(message: string) {
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("Could not find")
  );
}

function getPdfConfidenceLabel(score: number): ProposalData["confidence"] {
  if (score >= 85) return "High";
  if (score >= 65) return "Good";
  if (score >= 45) return "Moderate";
  return "Limited";
}

function getHomeownerSuitabilityLabel(score: number) {
  if (score >= 85) return "Strong Candidate";
  if (score >= 65) return "Good Candidate";
  if (score >= 45) return "Preliminary Estimate";
  return "Installer Verification Required";
}

function buildPanelSizeLabel(watts?: number) {
  return watts && watts > 0 ? `${Math.round(watts)}W module` : "Not saved";
}

function getPanelDisplayName(proposal: ProposalData) {
  const brand = proposal.selectedPanelBrand?.trim();
  const watts = proposal.selectedPanelWatts
    ? `${Math.round(proposal.selectedPanelWatts)}W`
    : "Not saved";

  if (!brand) {
    return watts;
  }

  return `${shortenPanelBrand(brand)} ${watts}`;
}

function shortenPanelBrand(brand: string) {
  if (/qcells|hanwha/i.test(brand)) return "Qcells";
  if (/canadian/i.test(brand)) return "Canadian";
  if (/sunpower/i.test(brand)) return "SunPower";
  if (/panasonic/i.test(brand)) return "Panasonic";
  if (/jinko/i.test(brand)) return "Jinko";
  return brand;
}

function getSunlightPdfColor(label: string, colors: PdfColors) {
  if (/high|strong|excellent/i.test(label)) return colors.green;
  if (/moderate/i.test(label)) return colors.gold;
  return colors.orange;
}

function positiveNumber(value: unknown) {
  const parsed = toFiniteNumber(value);
  return parsed > 0 ? parsed : undefined;
}

function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function finiteCoordinate(value: unknown, type: "lat" | "lng") {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  const limit = type === "lat" ? 90 : 180;

  return Number.isFinite(parsed) && Math.abs(parsed) <= limit
    ? parsed
    : undefined;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metersToSqFt(value?: number) {
  return value ? value * 10.7639 : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoneyMaybe(value?: number) {
  return hasFiniteValue(value) ? formatMoney(value) : "Estimate unavailable";
}

function formatKwMaybe(value?: number) {
  return hasFiniteValue(value)
    ? `${Number(value.toFixed(1))} kW`
    : "Estimate unavailable";
}

function formatSqFtMaybe(value?: number) {
  return hasFiniteValue(value)
    ? `${formatNumber(value)} sq ft`
    : "Estimate unavailable";
}

function formatPctMaybe(value?: number) {
  return hasFiniteValue(value)
    ? `${Math.round(value)}%`
    : "Estimate unavailable";
}

function formatKwhMaybe(value?: number) {
  return hasFiniteValue(value)
    ? `${formatNumber(value)} kWh / yr`
    : "Estimate unavailable";
}

function formatLbsMaybe(value?: number) {
  return hasFiniteValue(value)
    ? `${formatNumber(value)} lbs / yr`
    : "Estimate unavailable";
}

function hasFiniteValue(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}
