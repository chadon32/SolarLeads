import { NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import * as QRCode from "qrcode";
import {
  buildSolarReportFromSolarValues,
  type SolarReport,
} from "@/lib/solar-report";
import {
  APP_CANONICAL_URL,
  APP_NAME,
  APP_REPORT_NAME,
} from "@/lib/brand";
import {
  buildSolarAdvisorProfile,
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
  buildRoofAnalysisStaticMapUrl,
  getRoofAnalysisViewport,
  type RoofViewportPoint,
} from "@/lib/roof-analysis-viewport";
import {
  buildPanelCornerLatLngPoints,
  buildAcceptedPanelAnalysisForReport,
  buildSolarReportSnapshot,
  boundsToLatLngPoints,
  getRoofAnalysisSnapshotPoints,
  normalizeSolarReportSnapshot,
  outlineToLatLngPoints,
  type SolarReportSnapshot,
} from "@/lib/report-snapshot";
import {
  buildFallbackRoofAnalysis,
  type RoofAnalysis,
  type RoofGeoBounds,
} from "@/lib/roof-analysis";
import {
  buildSolarRoofAnalysis,
  fetchSolarBuildingInsights,
  geocodeAddress,
} from "@/lib/google-solar";
import {
  getCachedRoofAnalysis,
  saveCachedRoofAnalysis,
} from "@/lib/roof-analysis-cache";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

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
  reportUrl: string;
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
  federalTaxCredit?: number;
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
    const leadId = searchParams.get("leadId");
    const exp = searchParams.get("exp");
    const token = searchParams.get("token");

    if (!leadId) {
      return NextResponse.json({ message: "Missing leadId." }, { status: 400 });
    }

    const raw = searchParams.get("raw") === "1" || searchParams.get("download") === "1";
    const reportAccess = verifyReportAccess(request, leadId, exp, token);

    if (!reportAccess.ok) {
      return reportAccess.response;
    }

    if (!raw) {
      const viewerPath =
        reportAccess.dashboardToken &&
        reportAccess.dashboardToken !== "dashboard-session"
          ? `/report/${encodeURIComponent(leadId)}?token=${encodeURIComponent(
              reportAccess.dashboardToken
            )}`
          : reportAccess.dashboardToken === "dashboard-session"
            ? `/report/${encodeURIComponent(leadId)}`
            : buildReportViewerPath(leadId, {
                expiresAt: Number(exp),
              });

      return NextResponse.redirect(new URL(viewerPath, request.url));
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
        { message: error?.message || "Lead not found." },
        { status: 404 }
      );
    }

    const report = buildSolarReportFromSolarValues({
      annualSavings: toFiniteNumber(
        lead.annual_savings ?? lead.estimated_savings
      ),
      annualKwh: toFiniteNumber(lead.annual_energy_kwh),
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
    const reportSnapshot = await loadBestReportSnapshotForPdf(lead);
    const proposal = buildProposalData(lead, report, request.url, reportSnapshot);
    await markPdfDownloaded(supabase, lead.id, proposal);
    const roofAsset = await loadRoofImage(pdf, proposal);
    const assets: PdfAssets = {
      roofImage: roofAsset.image,
      roofImageViewport: roofAsset.viewport,
      qrImage: await loadQrImage(pdf, buildEstimateUrl(request.url, proposal.address)),
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

    const bytes = await pdf.save();

    const disposition =
      searchParams.get("download") === "1" ? "attachment" : "inline";

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${buildPdfFilename(proposal)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unexpected PDF generation error.",
      },
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
  | { ok: true; dashboardToken?: string }
  | { ok: false; response: NextResponse } {
  const dashboardAuth = verifyDashboardRequest(request);

  if (dashboardAuth.ok) {
    return { ok: true, dashboardToken: dashboardAuth.token };
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
        headers: { "Cache-Control": "no-store" },
      }
    ),
  };
}

async function loadBestReportSnapshotForPdf(
  lead: ReportLead
): Promise<SolarReportSnapshot | null> {
  const storedSnapshot = normalizeSolarReportSnapshot(lead.report_snapshot);

  if (storedSnapshot && hasHighValueRoofSnapshot(storedSnapshot)) {
    console.info("[pdf-roof-snapshot]", {
      confidence: storedSnapshot.roofModelConfidence,
      leadId: lead.id,
      panelCount: storedSnapshot.panelCount,
      source: "stored",
    });
    return storedSnapshot;
  }

  let lat = positiveNumber(lead.lat ?? storedSnapshot?.home?.lat);
  let lng = positiveNumber(lead.lng ?? storedSnapshot?.home?.lng);

  if (!lat || !lng) {
    const geocoded = await geocodeLeadForPdf(lead.address);

    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }

  if (!lat || !lng) {
    if (storedSnapshot) {
      console.info("[pdf-roof-snapshot]", {
        confidence: storedSnapshot.roofModelConfidence,
        leadId: lead.id,
        panelCount: storedSnapshot.panelCount,
        source: "stored-limited-no-coordinates",
      });
    }

    return storedSnapshot;
  }

  const fallback = buildFallbackRoofAnalysis({
    address: lead.address,
    lat,
    lng,
  });

  try {
    const cached = await getCachedRoofAnalysis({
      address: lead.address,
      lat,
      lng,
      fallback,
    });
    const cachedSnapshot = cached?.validSite
      ? buildSnapshotFromPdfAnalysis(lead, cached, lat, lng)
      : null;

    if (cachedSnapshot && hasHighValueRoofSnapshot(cachedSnapshot)) {
      console.info("[pdf-roof-snapshot]", {
        confidence: cachedSnapshot.roofModelConfidence,
        leadId: lead.id,
        panelCount: cachedSnapshot.panelCount,
        source: "cache",
      });
      return cachedSnapshot;
    }

    const insights = await fetchSolarBuildingInsights(lat, lng);
    const analysis = buildSolarRoofAnalysis({
      address: lead.address,
      lat,
      lng,
      insights,
    });

    if (!analysis.validSite) {
      return storedSnapshot ?? cachedSnapshot;
    }

    await saveCachedRoofAnalysis({
      address: lead.address,
      lat,
      lng,
      analysis,
    });

    const rebuiltSnapshot = buildSnapshotFromPdfAnalysis(lead, analysis, lat, lng);
    console.info("[pdf-roof-snapshot]", {
      confidence: rebuiltSnapshot.roofModelConfidence,
      leadId: lead.id,
      panelCount: rebuiltSnapshot.panelCount,
      source: "google-solar",
    });

    return hasHighValueRoofSnapshot(rebuiltSnapshot)
      ? rebuiltSnapshot
      : storedSnapshot ?? rebuiltSnapshot;
  } catch (error) {
    console.warn("[pdf-roof-snapshot-fallback]", {
      leadId: lead.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return storedSnapshot;
  }
}

async function geocodeLeadForPdf(address: string) {
  try {
    const geocoded = await geocodeAddress(address);
    return {
      lat: geocoded.lat,
      lng: geocoded.lng,
    };
  } catch (error) {
    console.warn("[pdf-roof-geocode-fallback]", {
      address,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

function buildSnapshotFromPdfAnalysis(
  lead: ReportLead,
  analysis: RoofAnalysis,
  lat: number,
  lng: number
) {
  const leadPanelCount = positiveNumber(lead.panel_count);
  const acceptedAnalysis = buildAcceptedPanelAnalysisForReport(analysis);

  return buildSolarReportSnapshot({
    activePanelCount:
      leadPanelCount ??
      acceptedAnalysis.acceptedPanelCount ??
      acceptedAnalysis.solarPanels.length ??
      acceptedAnalysis.panelCount,
    address: lead.address,
    analysis: acceptedAnalysis,
    lat,
    lng,
    monthlyBill: positiveNumber(lead.monthly_bill),
  });
}

function hasHighValueRoofSnapshot(snapshot: SolarReportSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.roofAnalysis.validSite &&
    snapshot.panelCount > 0 &&
    snapshot.roofModelConfidence >= 70 &&
    snapshot.roofAnalysis.solarPanels.length > 0
  );
}

function buildProposalData(
  lead: ReportLead,
  report: SolarReport,
  reportUrl: string,
  reportSnapshot: SolarReportSnapshot | null
): ProposalData {
  const snapshotMetrics = reportSnapshot?.metrics ?? null;
  const snapshotAnalysis = reportSnapshot?.roofAnalysis ?? null;
  const monthlyBill = positiveNumber(lead.monthly_bill ?? reportSnapshot?.monthlyBill);
  const annualSavings = positiveNumber(
    snapshotMetrics?.annualSavings ??
      lead.annual_savings ??
      lead.estimated_savings ??
      report.annualSavings
  );
  const monthlySavings =
    positiveNumber(snapshotMetrics?.monthlySavings ?? lead.monthly_savings) ??
    (annualSavings ? annualSavings / 12 : undefined);
  const panelCount =
    positiveNumber(reportSnapshot?.panelCount ?? snapshotMetrics?.panelCount) ??
    positiveNumber(lead.panel_count) ??
    positiveNumber(report.panelCount);
  const annualKwh = positiveNumber(
    snapshotMetrics?.annualKwh ?? lead.annual_energy_kwh
  );
  const directSystemKw = positiveNumber(
    snapshotMetrics?.systemKw ?? lead.system_size_kw
  );
  const systemKw =
    directSystemKw ?? (panelCount ? Number((panelCount * 0.4).toFixed(1)) : undefined);
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
  const sunlightHours =
    annualKwh && systemKw ? Math.round(annualKwh / systemKw) : undefined;
  const installedCost = positiveNumber(lead.system_cost_before_incentives) ?? (systemKw
    ? systemKw * 1000 * 2.75
    : panelCount
      ? panelCount * 400 * 2.75
      : undefined);
  const netSystemCost = positiveNumber(lead.net_system_cost) ??
    (installedCost ? installedCost * 0.7 : undefined);
  const grossPaybackYears =
    annualSavings && installedCost
      ? Number((installedCost / annualSavings).toFixed(1))
      : undefined;
  const netPaybackYears =
    annualSavings && netSystemCost
      ? Number((netSystemCost / annualSavings).toFixed(1))
      : undefined;
  const roiYears = netPaybackYears;
  const twentyYearSavings = annualSavings ? annualSavings * 20 : undefined;
  const costWithoutSolar20Yr = monthlyBill ? monthlyBill * 12 * 20 * 1.12 : undefined;
  const costWithSolar20Yr =
    costWithoutSolar20Yr && twentyYearSavings
      ? Math.max(0, costWithoutSolar20Yr - twentyYearSavings)
      : undefined;
  const annualImpactLbs = positiveNumber(report.annualImpactLbs);
  const energyOffsetPct =
    positiveNumber(snapshotMetrics?.coveragePct) ??
    (annualKwh && monthlyBill
      ? clamp(Math.round(((annualKwh * 0.13) / (monthlyBill * 12)) * 100), 0, 100)
      : positiveNumber(lead.energy_offset_pct ?? report.annualEnergyOffset));
  const suitabilityScore =
    positiveNumber(
      reportSnapshot?.solarReadinessScore ??
        reportSnapshot?.roofModelConfidence ??
        snapshotAnalysis?.rooftopConfidenceScore ??
        lead.solar_suitability_score
    ) ??
    getPdfSuitabilityScore({
      energyOffsetPct,
      panelCount,
      sunlightHours,
      usableRoofPct,
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

  return {
    id: lead.id,
    reportUrl,
    name: formatName(lead.name) || "Homeowner",
    address: lead.address || "Address unavailable",
    email: lead.email || "Email unavailable",
    phone: lead.phone || "Phone unavailable",
    lat: positiveNumber(reportSnapshot?.home?.lat ?? lead.lat),
    lng: positiveNumber(reportSnapshot?.home?.lng ?? lead.lng),
    generatedDate: new Date(lead.created_at || Date.now()).toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric", year: "numeric" }
    ),
    confidence,
    systemKwSource: "Modeled from panel layout",
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
    federalTaxCredit: installedCost ? installedCost * 0.3 : undefined,
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
    roofPitchDeg: positiveNumber(snapshotMetrics?.avgPitchDeg ?? lead.roof_pitch_deg),
    sunlightHours,
    suitabilityScore,
    suitabilityLabel: getHomeownerSuitabilityLabel(suitabilityScore),
    installedCost,
    costWithoutSolar20Yr,
    costWithSolar20Yr,
    advisor,
    reportSnapshot,
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

  drawCard(page, 42, 562, 528, 92, colors);
  page.drawText("Homeowner", {
    x: 58,
    y: 634,
    size: 8.5,
    font: fonts.bold,
    color: colors.muted,
  });
  drawTextBlock(page, proposal.name, 58, 616, 250, fonts.bold, 15.5, 17, colors.text);
  drawTextBlock(page, proposal.address, 58, 598, 250, fonts.regular, 10, 13, colors.muted);
  page.drawText(`Report ID ${proposal.id.slice(0, 8).toUpperCase()}`, {
    x: 58,
    y: 582,
    size: 8.2,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText("Generated", {
    x: 330,
    y: 634,
    size: 8.5,
    font: fonts.bold,
    color: colors.muted,
  });
  drawTextBlock(page, proposal.generatedDate, 330, 616, 106, fonts.bold, 12.8, 13.4, colors.text);
  drawConfidenceBadge(page, 448, 608, proposal.confidence, fonts, colors);
  page.drawText("Readiness", {
    x: 330,
    y: 596,
    size: 8.5,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(`${proposal.suitabilityScore}/100`, {
    x: 330,
    y: 578,
    size: 15,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText(proposal.suitabilityLabel, {
    x: 412,
    y: 582,
    size: 8.8,
    font: fonts.bold,
    color: colors.green,
  });

  drawRoofVisual(page, 42, 320, 528, 232, proposal, assets.roofImage, assets.roofImageViewport, fonts, colors, {
    compact: false,
    visualization: "panels",
  });
  drawRoofVisualCaption(page, 42, 303, 528, proposal, fonts, colors, "panels");

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
      label: "Solar readiness / energy offset",
      value: formatPctMaybe(proposal.energyOffsetPct),
      source: "User-adjusted" as SourceLabel,
      accent: colors.green,
    },
  ];
  const secondaryMetrics = [
    {
      label: "Solar-ready area",
      value: formatSqFtMaybe(proposal.usableAreaSqFt),
      source: "Solar API" as SourceLabel,
      accent: colors.blue,
    },
    {
      label: "Usable sunlight",
      value: proposal.sunlightHours
        ? `${formatNumber(proposal.sunlightHours)} hrs`
        : "Estimate unavailable",
      source: "Modeled" as SourceLabel,
      accent: colors.orange,
    },
  ];

  primaryMetrics.forEach((metric, index) => {
    drawMetricCard(page, 42 + index * 182, 206, 164, 82, metric.label, metric.value, metric.source, metric.accent, fonts, colors);
  });

  secondaryMetrics.forEach((metric, index) => {
    drawMetricCard(page, 42 + index * 273, 126, 255, 78, metric.label, metric.value, metric.source, metric.accent, fonts, colors);
  });

  drawCard(page, 42, 78, 528, 74, colors, colors.line);
  page.drawText("How to read this report", {
    x: 60,
    y: 128,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.utilityBillUploaded
      ? "This report uses satellite imagery, available solar data, modeled savings assumptions, and your submitted utility bill for quote review. It is a preliminary estimate; final design, pricing, incentives, and savings require installer verification."
      : "This report uses satellite imagery, available solar data, and modeled savings assumptions. It is a preliminary estimate; final design, pricing, incentives, and savings require installer verification.",
    60,
    104,
    300,
    fonts.regular,
    8.8,
    11.2,
    colors.muted
  );
  const guidanceBadges: Array<{ label: SourceLabel; description: string }> = [
    { label: "Solar API", description: "Roof geometry and imagery inputs" },
    { label: "Modeled", description: "Savings and production assumptions" },
    { label: "User-adjusted", description: "Bill and usage values you can update" },
  ];
  guidanceBadges.forEach((badge, index) => {
    drawBadgeWithDescription(page, 376, 122 - index * 18, badge.label, badge.description, fonts, colors);
  });
  if (proposal.utilityBillUploaded) {
    drawSourceBadge(page, 376, 68, "Utility Bill", fonts, colors);
  }
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
      .eq("id", leadId);
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

  drawCard(page, 42, 212, 258, 96, colors);
  drawPanelSummary(page, 58, 284, proposal, fonts, colors);
  drawCard(page, 312, 212, 258, 96, colors);
  drawRoofSummary(page, 328, 284, proposal, fonts, colors);

  drawCard(page, 42, 92, 528, 104, colors);
  page.drawText("AI Solar Advisor", {
    x: 60,
    y: 170,
    size: 13.5,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 448, 166, "Estimated", fonts, colors);
  drawTextBlock(
    page,
    proposal.advisor.summary,
    60,
    148,
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
    "This section translates the technical roof model into a homeowner-friendly readiness score. It uses roof fit, available sunlight, system size, and estimated bill offset. Internal lead scoring is intentionally not shown in this homeowner report.",
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
    `Accepted panel count: ${proposal.panelCount ?? 0}`,
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
    230,
    120,
    84,
    "Accepted panels",
    proposal.panelCount ? `${proposal.panelCount}` : "Unavailable",
    "Solar API",
    colors.cyan,
    fonts,
    colors
  );
  drawPanelSizeCard(page, 174, 230, 120, 92, proposal, fonts, colors);
  drawMetricCard(
    page,
    306,
    230,
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
    230,
    132,
    84,
    "Panel model",
    getPanelDisplayName(proposal),
    "Modeled",
    colors.gold,
    fonts,
    colors
  );

  drawCard(page, 42, 106, 528, 100, colors);
  page.drawText("Why this panel selection", {
    x: 60,
    y: 178,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    `The model prioritizes usable roof planes with stronger sunlight and enough continuous area for a practical residential array. The current layout supports ${proposal.panelCount ?? 0} accepted panels and a modeled ${formatKwMaybe(proposal.systemKw)} system. Panel count, equipment brand, and inverter selection should be confirmed during final installer design.`,
    60,
    158,
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
    "The sunlight layer explains where the roof appears strongest for solar production. Green areas indicate stronger sunlight quality, yellow indicates moderate sunlight, and orange/red indicates limited sunlight or possible shading.",
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

  drawCard(page, 42, 214, 250, 104, colors);
  page.drawText("Sunlight quality", {
    x: 60,
    y: 286,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(proposal.advisor.sunlightQuality.label, {
    x: 60,
    y: 258,
    size: 22,
    font: fonts.bold,
    color: getSunlightPdfColor(proposal.advisor.sunlightQuality.label, colors),
  });
  drawSourceBadge(page, 60, 232, proposal.advisor.sunlightQuality.source, fonts, colors);

  drawCard(page, 314, 214, 256, 104, colors);
  page.drawText("Roof exposure", {
    x: 332,
    y: 286,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.sunlightHours
      ? `${formatNumber(proposal.sunlightHours)} modeled annual sunlight hours are used with the accepted panel layout to estimate production. Exposure depends on roof direction, pitch, shade, and nearby obstructions.`
      : "Detailed sunlight hours were not saved for this lead, so the report uses the saved production and savings estimate.",
    332,
    264,
    210,
    fonts.regular,
    8.3,
    10.7,
    colors.muted
  );

  drawCard(page, 42, 96, 528, 92, colors);
  page.drawText("How to interpret the layer", {
    x: 60,
    y: 160,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.advisor.sunlightQuality.summary,
    60,
    140,
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
    "20-year savings",
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
    proposal.installedCost
      ? `${formatMoney((proposal.installedCost * 1.2) / 240)}/mo est.`
      : "Estimate unavailable",
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
      label: "Net payback (after 30% federal tax credit)",
      primary: true,
      value: proposal.netPaybackYears ? `${proposal.netPaybackYears} yrs` : "Unavailable",
    },
    { label: "Total 20-year cost with solar", value: formatMoneyMaybe(proposal.costWithSolar20Yr) },
    { label: "Total 20-year cost without solar", value: formatMoneyMaybe(proposal.costWithoutSolar20Yr) },
    { label: "Total 20-year savings", value: formatMoneyMaybe(proposal.twentyYearSavings) },
  ];

  rows.forEach((row, index) => {
    const y = 356 - index * 30;
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
    "* Net payback assumes the 30% federal Investment Tax Credit (ITC) is claimed in the year of installation. Consult a tax advisor for eligibility.",
    60,
    142,
    455,
    fonts.regular,
    7.4,
    9.6,
    colors.muted
  );

  drawDisclaimer(page, 42, 92, fonts, colors);
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
    `${proposal.panelCount ?? 0} accepted panels for a modeled ${formatKwMaybe(proposal.systemKw)} system.`,
    `${formatMoneyMaybe(proposal.annualSavings)} estimated annual savings from the current bill input.`,
    `${formatPctMaybe(proposal.energyOffsetPct)} estimated energy offset from modeled production.`,
    `Sunlight quality is ${proposal.advisor.sunlightQuality.label.toLowerCase()}.`,
  ].forEach((item, index) => drawBullet(page, 60, 392 - index * 25, item, fonts, colors, 7.8));

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

  drawCard(page, 338, 330, 232, 328, colors);
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
  drawContactRow(page, 356, 512, "Email", proposal.email, fonts, colors);
  drawContactRow(page, 356, 466, "Report ID", proposal.id, fonts, colors);
  drawContactRow(page, 356, 420, "Website", new URL(APP_CANONICAL_URL).hostname, fonts, colors);

  page.drawText("Open this report", {
    x: 356,
    y: 386,
    size: 9.2,
    font: fonts.bold,
    color: colors.muted,
  });
  if (assets.qrImage) {
    page.drawRectangle({ x: 356, y: 350, width: 90, height: 90, color: rgb(1, 1, 1) });
    page.drawImage(assets.qrImage, { x: 356, y: 350, width: 90, height: 90 });
  } else {
    drawCard(page, 356, 350, 90, 90, colors);
    page.drawText("QR unavailable", {
      x: 364,
      y: 390,
      size: 9,
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
    `This report is a strong starting point for ${proposal.address}. The saved model shows ${proposal.panelCount ?? 0} accepted panels, ${formatKwMaybe(proposal.systemKw)} system size, ${formatMoneyMaybe(proposal.annualSavings)} estimated annual savings, and ${formatPctMaybe(proposal.energyOffsetPct)} energy offset. Final design may change after installer verification.`,
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
  page.drawText(proposal.address, {
    x: 42,
    y: 42,
    size: 7.5,
    font: fonts.regular,
    color: colors.muted,
    maxWidth: 360,
  });
  page.drawText(`Report ${proposal.id.slice(0, 8).toUpperCase()}`, {
    x: 454,
    y: 42,
    size: 7.5,
    font: fonts.bold,
    color: colors.muted,
  });
}

function drawRoofVisual(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  proposal: ProposalData,
  image: PDFImage | null,
  imageViewport: RoofImageViewport | null,
  fonts: PdfFonts,
  colors: PdfColors,
  options: {
    compact?: boolean;
    showLegend?: boolean;
    visualization?: "roof" | "panels" | "sunlight";
  } = {}
) {
  const visualization = options.visualization ?? "roof";
  const overlayMode = getPdfRoofOverlayMode(proposal, visualization);
  const imageFrame = {
    height: height - 12,
    width: width - 12,
    x: x + 6,
    y: y + 6,
  };

  drawCard(page, x, y, width, height, colors);
  page.drawRectangle({
    x: imageFrame.x,
    y: imageFrame.y,
    width: imageFrame.width,
    height: imageFrame.height,
    color: colors.mapBg,
  });

  if (image) {
    drawRoofBaseImage(page, image, imageFrame, colors);
    drawRoofModelOverlay(
      page,
      imageFrame,
      proposal,
      imageViewport,
      fonts,
      colors,
      visualization,
      overlayMode
    );
    drawSelectedPropertyMarker(page, imageFrame, proposal, imageViewport, fonts, colors);
  } else {
    page.drawRectangle({
      x: imageFrame.x,
      y: imageFrame.y,
      width: imageFrame.width,
      height: imageFrame.height,
      color: colors.bg,
      opacity: 0.72,
    });
    page.drawText("Roof image unavailable", {
      x: x + 28,
      y: y + height / 2 + 8,
      size: 15,
      font: fonts.bold,
      color: colors.text,
    });
    drawTextBlock(
      page,
      "Live satellite imagery could not be embedded for this report. Metrics are still shown from the saved solar estimate where available.",
      x + 28,
      y + height / 2 - 14,
      width - 72,
      fonts.regular,
      8.8,
      11.5,
      colors.muted
    );
  }

  drawRoofImageHeader(page, imageFrame, proposal, fonts, colors, visualization, overlayMode, image);

  if (options.showLegend) {
    drawImageLegend(
      page,
      imageFrame.x + 6,
      imageFrame.y + 6,
      180,
      proposal,
      fonts,
      colors,
      {
        hasImage: Boolean(image),
        overlayMode,
        visualization,
      }
    );
  }
}

function drawRoofBaseImage(
  page: PDFPage,
  image: PDFImage,
  frame: { x: number; y: number; width: number; height: number },
  colors: PdfColors
) {
  const coverScale = Math.max(frame.width / image.width, frame.height / image.height);
  const drawnWidth = image.width * coverScale;
  const drawnHeight = image.height * coverScale;
  const drawX = frame.x + (frame.width - drawnWidth) / 2;
  const drawY = frame.y + (frame.height - drawnHeight) / 2;

  page.drawImage(image, {
    x: drawX,
    y: drawY,
    width: drawnWidth,
    height: drawnHeight,
    opacity: 0.96,
  });

  // Mask any overflow so the image behaves like a cropped report plate.
  if (drawY < frame.y) {
    page.drawRectangle({
      x: drawX,
      y: drawY,
      width: drawnWidth,
      height: frame.y - drawY,
      color: colors.card,
    });
  }
  if (drawY + drawnHeight > frame.y + frame.height) {
    page.drawRectangle({
      x: drawX,
      y: frame.y + frame.height,
      width: drawnWidth,
      height: drawY + drawnHeight - (frame.y + frame.height),
      color: colors.card,
    });
  }
  if (drawX < frame.x) {
    page.drawRectangle({
      x: drawX,
      y: frame.y,
      width: frame.x - drawX,
      height: frame.height,
      color: colors.card,
    });
  }
  if (drawX + drawnWidth > frame.x + frame.width) {
    page.drawRectangle({
      x: frame.x + frame.width,
      y: frame.y,
      width: drawX + drawnWidth - (frame.x + frame.width),
      height: frame.height,
      color: colors.card,
    });
  }

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

function drawSelectedPropertyMarker(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  imageViewport: RoofImageViewport | null,
  fonts: PdfFonts,
  colors: PdfColors
) {
  const projector = imageViewport ? createStaticMapProjector(imageViewport, frame) : null;
  const projectedHome =
    proposal.reportSnapshot?.home && projector
      ? projector(proposal.reportSnapshot.home)
      : null;
  const cx = projectedHome?.x ?? frame.x + frame.width * 0.52;
  const cy = projectedHome?.y ?? frame.y + frame.height * 0.5;
  page.drawCircle({ x: cx, y: cy, size: 11, color: colors.cyan, opacity: 0.12 });
  page.drawCircle({
    x: cx,
    y: cy,
    size: 4.4,
    borderColor: colors.cyan,
    borderWidth: 1.2,
    color: colors.bg,
    opacity: 0.82,
  });
  page.drawLine({ start: { x: cx - 14, y: cy }, end: { x: cx - 6, y: cy }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx + 6, y: cy }, end: { x: cx + 14, y: cy }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx, y: cy - 14 }, end: { x: cx, y: cy - 6 }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx, y: cy + 6 }, end: { x: cx, y: cy + 14 }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawRectangle({
    x: cx + 12,
    y: cy + 12,
    width: 78,
    height: 16,
    color: colors.badgeFill,
    opacity: 0.84,
  });
  page.drawText("Selected Home", {
    x: cx + 20,
    y: cy + 17,
    size: 6.6,
    font: fonts.bold,
    color: colors.text,
  });
}

function drawRoofModelOverlay(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  imageViewport: RoofImageViewport | null,
  fonts: PdfFonts,
  colors: PdfColors,
  visualization: "roof" | "panels" | "sunlight",
  overlayMode: "exact" | "estimated"
) {
  if (
    drawSnapshotRoofModelOverlay(
      page,
      frame,
      proposal,
      imageViewport,
      fonts,
      colors,
      visualization,
      overlayMode
    )
  ) {
    return;
  }

  const roof = getReportRoofPolygon(frame);
  const usable = getReportUsablePolygon(frame);
  const setback = getReportSetbackPolygon(roof, usable);

  if (visualization === "sunlight") {
    drawSunlightBands(page, usable, proposal, colors);
  }

  drawPolygon(
    page,
    roof,
    colors.cyan,
    visualization === "sunlight" ? 0.03 : 0.045,
    colors.cyan,
    0.85,
    0.58
  );
  drawPolygon(
    page,
    setback,
    colors.gold,
    0.015,
    colors.gold,
    0.5,
    0.36
  );
  drawPolygon(
    page,
    usable,
    visualization === "sunlight" ? colors.green : colors.cyan,
    visualization === "sunlight" ? 0.05 : 0.07,
    visualization === "sunlight" ? colors.green : colors.cyan,
    0.65,
    0.42
  );

  if (visualization === "panels") {
    if (overlayMode === "exact") {
      drawPanelLayoutOverlay(page, frame, proposal, colors);
    } else {
      drawEstimatedCapacityOverlay(page, frame, proposal, fonts, colors);
    }
  }
}

function drawSnapshotRoofModelOverlay(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  imageViewport: RoofImageViewport | null,
  fonts: PdfFonts,
  colors: PdfColors,
  visualization: "roof" | "panels" | "sunlight",
  overlayMode: "exact" | "estimated"
) {
  const snapshot = proposal.reportSnapshot;

  if (!snapshot || !imageViewport) {
    return false;
  }

  const roofData = snapshot.roofAnalysis;
  const projector = createStaticMapProjector(imageViewport, frame);
  const roofPolygon = projectLatLngPolygon(
    outlineToLatLngPoints(roofData.roofOutline, roofData.roofBounds),
    projector
  );
  const usablePolygon = projectLatLngPolygon(
    outlineToLatLngPoints(roofData.usableOutline, roofData.roofBounds),
    projector
  );
  const fallbackRoof = projectLatLngPolygon(
    boundsToLatLngPoints(roofData.roofBounds),
    projector
  );
  const roof = roofPolygon.length >= 3 ? roofPolygon : fallbackRoof;
  const usable = usablePolygon.length >= 3 ? usablePolygon : roof;

  if (roof.length < 3) {
    return false;
  }

  if (visualization === "sunlight" && usable.length >= 3) {
    drawSunlightBands(page, usable, proposal, colors);
  }

  roofData.roofSegments.forEach((segment) => {
    const segmentPolygon = projectLatLngPolygon(
      segment.outline.length >= 3
        ? outlineToLatLngPoints(segment.outline, roofData.roofBounds)
        : boundsToLatLngPoints(segment.bounds),
      projector
    );

    if (segmentPolygon.length >= 3) {
      drawPolygon(
        page,
        segmentPolygon,
        segment.usable ? colors.cyan : colors.slate,
        segment.usable ? 0.022 : 0.012,
        segment.usable ? colors.cyan : colors.slate,
        0.46,
        0.26
      );
    }
  });

  drawPolygon(page, roof, colors.cyan, 0.022, colors.cyan, 0.9, 0.42);

  if (usable.length >= 3) {
    drawPolygon(
      page,
      usable,
      visualization === "sunlight" ? colors.green : colors.cyan,
      visualization === "sunlight" ? 0.05 : 0.055,
      visualization === "sunlight" ? colors.green : colors.cyan,
      0.65,
      0.34
    );
  }

  if (visualization === "panels") {
    if (overlayMode === "exact" && roofData.solarPanels.length > 0) {
      drawSnapshotPanelLayoutOverlay(
        page,
        roofData,
        Math.round(proposal.panelCount ?? snapshot.panelCount),
        projector,
        colors
      );
    } else {
      drawEstimatedCapacityOverlay(page, frame, proposal, fonts, colors);
    }
  }

  return true;
}

function drawSnapshotPanelLayoutOverlay(
  page: PDFPage,
  roofData: RoofAnalysis,
  panelCount: number,
  projector: (point: RoofViewportPoint) => { x: number; y: number },
  colors: PdfColors
) {
  const panels = roofData.solarPanels.slice(
    0,
    clamp(Math.round(panelCount), 0, roofData.solarPanels.length)
  );

  panels.forEach((panel) => {
    const corners = buildPanelCornerLatLngPoints({
      analysis: roofData,
      panel,
      panels: roofData.solarPanels,
    }).slice(1);
    const panelPolygon = projectLatLngPolygon(corners, projector);

    if (panelPolygon.length >= 4) {
      drawPolygon(page, panelPolygon, colors.blue, 0.64, colors.text, 0.5, 0.4);
    }

    const center = projector(panel.center);
    page.drawRectangle({
      x: center.x - 6.5,
      y: center.y - 9,
      width: 13,
      height: 18,
      color: colors.blue,
      opacity: 0.88,
      borderColor: colors.cyan,
      borderOpacity: 0.82,
      borderWidth: 0.75,
    });
  });
}

function projectLatLngPolygon(
  points: RoofViewportPoint[],
  projector: (point: RoofViewportPoint) => { x: number; y: number }
) {
  return points
    .map((point) => {
      const projected = projector(point);
      return [projected.x, projected.y];
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function getReportRoofPolygon(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const left = frame.x + frame.width * 0.27;
  const right = frame.x + frame.width * 0.73;
  const bottom = frame.y + frame.height * 0.17;
  const top = frame.y + frame.height * 0.78;
  const width = frame.width;
  const height = frame.height;

  return [
    [left + width * 0.05, top],
    [right - width * 0.03, top - height * 0.05],
    [right, bottom + height * 0.24],
    [right - width * 0.16, bottom],
    [left + width * 0.06, bottom + height * 0.04],
    [left, bottom + height * 0.31],
  ];
}

function getReportUsablePolygon(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const left = frame.x + frame.width * 0.33;
  const right = frame.x + frame.width * 0.67;
  const bottom = frame.y + frame.height * 0.27;
  const top = frame.y + frame.height * 0.68;
  const width = frame.width;
  const height = frame.height;

  return [
    [left + width * 0.04, top],
    [right - width * 0.02, top - height * 0.02],
    [right, bottom + height * 0.13],
    [right - width * 0.12, bottom],
    [left + width * 0.02, bottom + height * 0.04],
    [left, bottom + height * 0.22],
  ];
}

function getReportSetbackPolygon(roof: number[][], usable: number[][]) {
  return roof.map(([roofX, roofY], index) => {
    const [usableX, usableY] = usable[index] ?? [roofX, roofY];

    return [roofX + (usableX - roofX) * 0.45, roofY + (usableY - roofY) * 0.45];
  });
}

function drawPanelLayoutOverlay(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  colors: PdfColors
) {
  const panelCount = clamp(Math.round(proposal.panelCount ?? 0), 0, 48);
  if (panelCount <= 0) return;

  const rows = Math.max(2, Math.ceil(Math.sqrt(panelCount / 1.8)));
  const cols = Math.ceil(panelCount / rows);
  const panelW = Math.min(19, (frame.width * 0.29) / cols);
  const panelH = Math.min(11, (frame.height * 0.26) / rows);
  const gap = 2.2;
  const layoutW = cols * panelW + (cols - 1) * gap;
  const layoutH = rows * panelH + (rows - 1) * gap;
  const startX = frame.x + frame.width * 0.5 - layoutW / 2;
  const startY = frame.y + frame.height * 0.5 - layoutH / 2;

  for (let index = 0; index < panelCount; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    drawRotatedRect(
      page,
      startX + col * (panelW + gap),
      startY + (rows - row - 1) * (panelH + gap),
      panelW,
      panelH,
      -5.5,
      colors.blue,
      0.54,
      colors.text,
      0.32
    );
  }
}

function drawEstimatedCapacityOverlay(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors
) {
  page.drawRectangle({
    x: frame.x + frame.width - 168,
    y: frame.y + 18,
    width: 150,
    height: 38,
    color: colors.badgeFill,
    opacity: 0.72,
  });
  page.drawText("Estimated capacity view", {
    x: frame.x + frame.width - 156,
    y: frame.y + 42,
    size: 7.2,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(`Up to ${proposal.panelCount ?? 0} panels`, {
    x: frame.x + frame.width - 156,
    y: frame.y + 28,
    size: 6.8,
    font: fonts.regular,
    color: colors.muted,
  });
}

function drawRoofImageHeader(
  page: PDFPage,
  frame: { x: number; y: number; width: number; height: number },
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors,
  visualization: "roof" | "panels" | "sunlight",
  overlayMode: "exact" | "estimated",
  image: PDFImage | null
) {
  const title =
    visualization === "panels"
      ? overlayMode === "exact"
        ? "Sample Panel Layout"
        : "Estimated Capacity View"
      : visualization === "sunlight"
        ? "Solar Readiness View"
        : "Usable Roof Area";
  const secondary =
    visualization === "sunlight"
      ? `${proposal.advisor.sunlightQuality.label} sunlight quality`
      : overlayMode === "exact"
        ? `${proposal.panelCount ?? 0} panel sample layout`
        : `${proposal.panelCount ?? 0} panel estimate`;

  page.drawRectangle({
    x: frame.x + 12,
    y: frame.y + frame.height - 24,
    width: 126,
    height: 16,
    color: colors.badgeFill,
    opacity: 0.76,
  });
  page.drawText(title, {
    x: frame.x + 20,
    y: frame.y + frame.height - 19,
    size: 6.9,
    font: fonts.bold,
    color: colors.text,
  });

  page.drawRectangle({
    x: frame.x + 146,
    y: frame.y + frame.height - 24,
    width: Math.min(136, fonts.regular.widthOfTextAtSize(secondary, 6.8) + 18),
    height: 16,
    color: colors.badgeFill,
    opacity: 0.64,
  });
  page.drawText(secondary, {
    x: frame.x + 154,
    y: frame.y + frame.height - 19,
    size: 6.8,
    font: fonts.regular,
    color: colors.text,
  });

  if (!image) {
    return;
  }

  drawConfidenceBadge(page, frame.x + frame.width - 112, frame.y + frame.height - 24, proposal.confidence, fonts, colors);
}

function getPdfRoofOverlayMode(
  proposal: ProposalData,
  visualization: "roof" | "panels" | "sunlight"
) {
  if (visualization !== "panels") {
    return "exact" as const;
  }

  const score = proposal.suitabilityScore ?? 0;

  if (proposal.panelCount && proposal.panelCount > 0 && score >= 72 && proposal.confidence !== "Limited") {
    return "exact" as const;
  }

  return "estimated" as const;
}

function drawSunlightBands(
  page: PDFPage,
  polygon: number[][],
  proposal: ProposalData,
  colors: PdfColors
) {
  const xs = polygon.map(([px]) => px);
  const ys = polygon.map(([, py]) => py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sunlightLabel = proposal.advisor.sunlightQuality.label;
  const strongShare = sunlightLabel === "HIGH" ? 0.62 : sunlightLabel === "MODERATE" ? 0.42 : 0.26;
  const bandWidth = (maxX - minX) / 3;

  page.drawRectangle({
    x: minX,
    y: minY,
    width: bandWidth,
    height: maxY - minY,
    color: colors.green,
    opacity: 0.18 + strongShare * 0.1,
  });
  page.drawRectangle({
    x: minX + bandWidth,
    y: minY,
    width: bandWidth,
    height: maxY - minY,
    color: colors.gold,
    opacity: 0.2,
  });
  page.drawRectangle({
    x: minX + bandWidth * 2,
    y: minY,
    width: bandWidth,
    height: maxY - minY,
    color: colors.orange,
    opacity: 0.16,
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
  page.drawText("Recommended panel count", {
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
  const pitch = proposal.roofPitchDeg
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
    drawBullet(page, x + 16, y + 78 - index * 18, bullet, fonts, colors, 7.8);
  });
  page.drawText(impactLabel, {
    x: x + 14,
    y: y + 18,
    size: 7.4,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(monthlyImpact, {
    x: x + 14,
    y: y + 36,
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
  drawTextBlock(page, value, x, y - 15, 176, fonts.bold, 9.6, 11.4, colors.text);
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
  drawCard(page, x, y, width, height, colors);
  page.drawRectangle({ x, y: y + height - 4, width, height: 4, color: accent, opacity: 0.75 });
  page.drawText(label, {
    x: x + 10,
    y: y + height - 22,
    size: 7.4,
    font: fonts.bold,
    color: colors.muted,
  });
  drawTextBlock(
    page,
    value,
    x + 10,
    y + height - 44,
    width - 20,
    fonts.bold,
    value.length > 19 ? 11.5 : value.length > 12 ? 14.5 : 18,
    18,
    value.includes("unavailable") ? colors.muted : colors.text
  );
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

function drawBadgeWithDescription(
  page: PDFPage,
  x: number,
  y: number,
  label: SourceLabel,
  description: string,
  fonts: PdfFonts,
  colors: PdfColors
) {
  drawSourceBadge(page, x, y, label, fonts, colors);
  page.drawText(description, {
    x: x + 106,
    y: y + 6,
    size: 7.5,
    font: fonts.regular,
    color: colors.muted,
  });
}

function drawConfidenceBadge(
  page: PDFPage,
  x: number,
  y: number,
  confidence: ProposalData["confidence"],
  fonts: PdfFonts,
  colors: PdfColors
) {
  const color =
    confidence === "High"
      ? colors.green
      : confidence === "Good"
        ? colors.gold
        : confidence === "Moderate"
          ? colors.orange
          : colors.slate;
  const label = `${confidence} confidence`;
  const width = Math.max(108, fonts.bold.widthOfTextAtSize(label, 8.4) + 22);
  page.drawRectangle({
    x,
    y,
    width,
    height: 26,
    color,
    opacity: 0.15,
    borderColor: color,
    borderWidth: 0.8,
  });
  page.drawText(label, {
    x: x + 10,
    y: y + 9,
    size: 8.4,
    font: fonts.bold,
    color: colors.text,
  });
}

function drawImageLegend(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors,
  options: {
    hasImage: boolean;
    overlayMode: "exact" | "estimated";
    visualization: "roof" | "panels" | "sunlight";
  }
) {
  const items = [
    {
      color: colors.cyan,
      fillOpacity: 0.18,
      label: options.hasImage ? "Selected Home" : "Satellite image unavailable",
    },
    {
      color: colors.blue,
      fillOpacity: 0.42,
      label:
        options.overlayMode === "exact"
          ? "Sample Panel Layout"
          : `Estimated capacity up to ${proposal.panelCount ?? 0} panels`,
    },
    {
      color: colors.green,
      fillOpacity: options.visualization === "sunlight" ? 0.34 : 0.14,
      label:
        options.visualization === "sunlight"
          ? `${proposal.advisor.sunlightQuality.label} sunlight quality`
          : "Sunlight quality layer",
    },
    {
      color: colors.gold,
      fillOpacity: 0.08,
      label: "Usable Roof Area / Required Setback",
    },
    {
      color: colors.slate,
      fillOpacity: 0.12,
      label: "Final installer verification required",
    },
  ];
  const rowHeight = 11;
  const legendHeight = items.length * rowHeight + 12;

  page.drawRectangle({
    x,
    y,
    width,
    height: legendHeight,
    color: colors.badgeFill,
    opacity: 0.75,
    borderColor: colors.line,
    borderWidth: 0.5,
  });

  items.forEach((item, index) => {
    const itemY = y + legendHeight - 18 - index * rowHeight;
    page.drawRectangle({
      x: x + 6,
      y: itemY,
      width: 7,
      height: 7,
      color: item.color,
      opacity: item.fillOpacity,
      borderColor: item.color,
      borderWidth: 0.45,
    });
    page.drawText(item.label, {
      x: x + 18,
      y: itemY + 0.5,
      size: 6.5,
      font: fonts.regular,
      color: colors.text,
      maxWidth: width - 24,
    });
  });
}

function drawRoofVisualCaption(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  proposal: ProposalData,
  fonts: PdfFonts,
  colors: PdfColors,
  visualization: "roof" | "panels" | "sunlight"
) {
  const overlayMode = getPdfRoofOverlayMode(proposal, visualization);
  const leading =
    overlayMode === "exact"
      ? "Preliminary rooftop analysis based on satellite imagery and available solar data."
      : `Estimated capacity view based on usable roof area and saved solar metrics.`;
  const trailing =
    visualization === "sunlight"
      ? "Final panel placement and sunlight performance require installer verification."
      : "Final panel placement requires installer verification.";

  drawTextBlock(
    page,
    `${leading} ${trailing}`,
    x,
    y,
    width,
    fonts.regular,
    8.2,
    10.4,
    colors.muted
  );
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
  page.drawCircle({ x: x + 3, y: y + 3, size: 2.5, color: colors.cyan, opacity: 0.85 });
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

function drawRotatedRect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  angleDeg: number,
  color: Color,
  opacity: number,
  borderColor: Color,
  borderOpacity: number
) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const angle = (angleDeg * Math.PI) / 180;
  const points = [
    rotatePoint(x, y, cx, cy, angle),
    rotatePoint(x + width, y, cx, cy, angle),
    rotatePoint(x + width, y + height, cx, cy, angle),
    rotatePoint(x, y + height, cx, cy, angle),
  ];
  drawPolygon(page, points, color, opacity, borderColor, 0.6, borderOpacity);
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
    .map(([px, py], index) => `${index === 0 ? "M" : "L"} ${px} ${py}`)
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
  const words = sanitizePdfText(text).split(/\s+/);
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
  const mapsKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
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

      const response = await fetch(staticMapUrl);

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

function createStaticMapProjector(
  viewport: RoofImageViewport,
  frame: { x: number; y: number; width: number; height: number }
) {
  const centerWorld = latLngToWorldPoint(viewport.center);
  const zoomScale = 2 ** viewport.zoom;

  return (point: RoofViewportPoint) => {
    const world = latLngToWorldPoint(point);
    const pixelX = (world.x - centerWorld.x) * zoomScale + viewport.width / 2;
    const pixelY = (world.y - centerWorld.y) * zoomScale + viewport.height / 2;

    return {
      x: frame.x + (pixelX / viewport.width) * frame.width,
      y: frame.y + frame.height - (pixelY / viewport.height) * frame.height,
    };
  };
}

function latLngToWorldPoint(point: RoofViewportPoint) {
  const siny = clamp(
    Math.sin((point.lat * Math.PI) / 180),
    -0.9999,
    0.9999
  );

  return {
    x: ((point.lng + 180) / 360) * 256,
    y: (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * 256,
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

function buildEstimateUrl(requestUrl: string, address: string) {
  const origin = new URL(requestUrl).origin;
  return `${origin}/estimate?address=${encodeURIComponent(address)}`;
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

function rotatePoint(x: number, y: number, cx: number, cy: number, angle: number) {
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}

function shouldRetryLegacySelect(message: string) {
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("Could not find")
  );
}

function getPdfSuitabilityScore({
  energyOffsetPct,
  panelCount,
  sunlightHours,
  usableRoofPct,
}: {
  energyOffsetPct?: number;
  panelCount?: number;
  sunlightHours?: number;
  usableRoofPct?: number;
}) {
  const sunlightScore = clamp(((sunlightHours ?? 0) / 2100) * 100, 0, 100);
  const areaScore = clamp(usableRoofPct ?? 0, 0, 100);
  const panelScore = clamp(((panelCount ?? 0) / 24) * 100, 0, 100);
  const offsetScore = clamp(energyOffsetPct ?? 0, 0, 100);

  return clamp(
    Math.round(
      sunlightScore * 0.28 +
        areaScore * 0.22 +
        panelScore * 0.26 +
        offsetScore * 0.24
    ),
    0,
    100
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
  const normalizedWatts = watts && watts > 0 ? Math.round(watts) : 400;
  return `${normalizedWatts}W module`;
}

function getPanelDisplayName(proposal: ProposalData) {
  const brand = proposal.selectedPanelBrand?.trim();
  const watts = proposal.selectedPanelWatts
    ? `${Math.round(proposal.selectedPanelWatts)}W`
    : "400W";

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
  return value ? formatMoney(value) : "Estimate unavailable";
}

function formatKwMaybe(value?: number) {
  return value ? `${Number(value.toFixed(1))} kW` : "Estimate unavailable";
}

function formatSqFtMaybe(value?: number) {
  return value ? `${formatNumber(value)} sq ft` : "Estimate unavailable";
}

function formatPctMaybe(value?: number) {
  return value ? `${Math.round(value)}%` : "Estimate unavailable";
}

function formatKwhMaybe(value?: number) {
  return value ? `${formatNumber(value)} kWh / yr` : "Estimate unavailable";
}

function formatLbsMaybe(value?: number) {
  return value ? `${formatNumber(value)} lbs / yr` : "Estimate unavailable";
}
