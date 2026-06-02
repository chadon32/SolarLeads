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
  | "Requested"
  | "Next Step";

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
  leadScore: number;
  leadScoreLabel: LeadScoreLabel;
  quoteRequested: boolean;
  utilityBillUploaded: boolean;
  roofAreaSqFt?: number;
  usableAreaSqFt?: number;
  usableRoofPct?: number;
  roofPitchDeg?: number;
  sunlightHours?: number;
  suitabilityScore: number;
  installedCost?: number;
  costWithoutSolar20Yr?: number;
  costWithSolar20Yr?: number;
  advisor: SolarAdvisorProfile;
};

type PdfAssets = {
  roofImage: PDFImage | null;
  qrImage: PDFImage | null;
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
      "id, name, email, phone, address, monthly_bill, estimated_savings, created_at, panel_count, system_size_kw, annual_savings, monthly_savings, annual_energy_kwh, roof_area_m2, usable_area_m2, roof_pitch_deg, selected_panel_brand, selected_panel_model, selected_panel_watts, system_cost_before_incentives, net_system_cost, energy_offset_pct, lead_score, lead_score_label, pdf_downloaded, pdf_generated, quote_requested, solar_suitability_score, twenty_year_savings, utility_bill_uploaded, lat, lng";
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
    const proposal = buildProposalData(lead, report, request.url);
    await markPdfDownloaded(supabase, lead.id, proposal);
    const assets: PdfAssets = {
      roofImage: await loadRoofImage(pdf, proposal),
      qrImage: await loadQrImage(pdf, buildEstimateUrl(request.url, proposal.address)),
    };

    drawExecutiveSummary(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawRoofAnalysisPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);
    drawSavingsPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawFinancingPage(pdf.addPage([612, 792]), proposal, fonts, colors);
    drawNextStepsPage(pdf.addPage([612, 792]), proposal, assets, fonts, colors);

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
    ? "Report links are not configured. Please contact Arizona Solar AI for a fresh report link."
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

function buildProposalData(
  lead: ReportLead,
  report: SolarReport,
  reportUrl: string
): ProposalData {
  const monthlyBill = positiveNumber(lead.monthly_bill);
  const annualSavings = positiveNumber(
    lead.annual_savings ?? lead.estimated_savings ?? report.annualSavings
  );
  const monthlySavings =
    positiveNumber(lead.monthly_savings) ??
    (annualSavings ? annualSavings / 12 : undefined);
  const panelCount =
    positiveNumber(lead.panel_count) ?? positiveNumber(report.panelCount);
  const annualKwh = positiveNumber(lead.annual_energy_kwh);
  const directSystemKw = positiveNumber(lead.system_size_kw);
  const systemKw =
    directSystemKw ?? (panelCount ? Number((panelCount * 0.4).toFixed(1)) : undefined);
  const roofAreaSqFt = metersToSqFt(positiveNumber(lead.roof_area_m2));
  const usableAreaSqFt = metersToSqFt(positiveNumber(lead.usable_area_m2));
  const usableRoofPct =
    roofAreaSqFt && usableAreaSqFt
      ? clamp(Math.round((usableAreaSqFt / roofAreaSqFt) * 100), 1, 100)
      : undefined;
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
    annualKwh && monthlyBill
      ? clamp(Math.round(((annualKwh * 0.13) / (monthlyBill * 12)) * 100), 0, 100)
      : positiveNumber(lead.energy_offset_pct ?? report.annualEnergyOffset);
  const suitabilityScore = getPdfSuitabilityScore({
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
    roofSegments: [],
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
    lat: positiveNumber(lead.lat),
    lng: positiveNumber(lead.lng),
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
    leadScore,
    leadScoreLabel: normalizeLeadScoreLabel(lead.lead_score_label, leadScore),
    quoteRequested: Boolean(lead.quote_requested),
    utilityBillUploaded: Boolean(lead.utility_bill_uploaded),
    roofAreaSqFt,
    usableAreaSqFt,
    usableRoofPct,
    roofPitchDeg: positiveNumber(lead.roof_pitch_deg),
    sunlightHours,
    suitabilityScore,
    installedCost,
    costWithoutSolar20Yr,
    costWithSolar20Yr,
    advisor,
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

  page.drawText("Your Solar Potential Report", {
    x: 42,
    y: 694,
    size: 31,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText("Personalized roof analysis and savings estimate", {
    x: 42,
    y: 670,
    size: 12,
    font: fonts.regular,
    color: colors.muted,
  });

  drawCard(page, 42, 574, 250, 68, colors);
  drawTextBlock(page, proposal.name, 58, 620, 212, fonts.bold, 15, 16, colors.text);
  drawTextBlock(page, proposal.address, 58, 596, 212, fonts.regular, 9.5, 12, colors.muted);
  page.drawText(`Report ID ${proposal.id.slice(0, 8).toUpperCase()}`, {
    x: 58,
    y: 582,
    size: 8,
    font: fonts.bold,
    color: colors.cyan,
  });

  drawCard(page, 310, 574, 260, 68, colors);
  page.drawText("Report generated", {
    x: 326,
    y: 620,
    size: 8.5,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(proposal.generatedDate, {
    x: 326,
    y: 600,
    size: 15,
    font: fonts.bold,
    color: colors.text,
  });
  drawConfidenceBadge(page, 456, 599, proposal.confidence, fonts, colors);
  page.drawText(`Lead score ${proposal.leadScore}/100`, {
    x: 326,
    y: 582,
    size: 8,
    font: fonts.bold,
    color: colors.cyan,
  });
  page.drawText(proposal.leadScoreLabel, {
    x: 408,
    y: 582,
    size: 8,
    font: fonts.bold,
    color: getLeadScorePdfColor(proposal.leadScoreLabel, colors),
  });

  drawRoofVisual(page, 42, 328, 528, 218, proposal, assets.roofImage, fonts, colors, {
    compact: false,
  });

  const metrics = [
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
      label: "Energy offset",
      value: formatPctMaybe(proposal.energyOffsetPct),
      source: "User-adjusted" as SourceLabel,
      accent: colors.green,
    },
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

  metrics.forEach((metric, index) => {
    drawMetricCard(
      page,
      42 + index * 106,
      230,
      94,
      70,
      metric.label,
      metric.value,
      metric.source,
      metric.accent,
      fonts,
      colors
    );
  });

  drawCard(page, 42, 118, 528, 78, colors);
  page.drawText("How to read this report", {
    x: 60,
    y: 170,
    size: 12,
    font: fonts.bold,
    color: colors.text,
  });
  drawTextBlock(
    page,
    proposal.utilityBillUploaded
      ? "This report combines available satellite imagery, Solar API roof data, Arizona-specific modeled savings assumptions, and a submitted utility bill for quote review. It is a preliminary estimate; final design, pricing, incentives, and savings require installer verification."
      : "This report combines available satellite imagery, Solar API roof data, and Arizona-specific modeled savings assumptions. It is a preliminary estimate; final design, pricing, incentives, and savings require installer verification.",
    60,
    151,
    486,
    fonts.regular,
    9.5,
    13,
    colors.muted
  );
  drawSourceBadge(page, 60, 122, "Solar API", fonts, colors);
  drawSourceBadge(page, 132, 122, "Modeled", fonts, colors);
  drawSourceBadge(page, 196, 122, "User-adjusted", fonts, colors);
  if (proposal.utilityBillUploaded) {
    page.drawText("Utility bill uploaded for quote review.", {
      x: 306,
      y: 126,
      size: 7.5,
      font: fonts.bold,
      color: colors.green,
    });
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
    470,
    fonts.regular,
    10,
    13,
    colors.muted
  );

  drawRoofVisual(page, 42, 370, 528, 260, proposal, assets.roofImage, fonts, colors, {
    compact: false,
    showLegend: true,
  });

  drawCard(page, 42, 250, 258, 88, colors);
  drawPanelSummary(page, 58, 315, proposal, fonts, colors);
  drawCard(page, 312, 250, 258, 88, colors);
  drawRoofSummary(page, 328, 315, proposal, fonts, colors);

  drawCard(page, 42, 82, 528, 130, colors);
  page.drawText("AI Solar Advisor", {
    x: 60,
    y: 188,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 458, 188, "Estimated", fonts, colors);
  drawTextBlock(
    page,
    proposal.advisor.summary,
    60,
    170,
    492,
    fonts.regular,
    8.1,
    10.2,
    colors.muted
  );
  page.drawText(proposal.advisor.suitability.headline, {
    x: 60,
    y: 118,
    size: 9,
    font: fonts.bold,
    color: colors.cyan,
  });
  proposal.advisor.suitability.positiveFactors
    .slice(0, 2)
    .forEach((reason, index) => {
      drawBullet(page, 62, 99 - index * 15, reason, fonts, colors, 7.4);
    });
  drawTextBlock(
    page,
    `Shade / sunlight quality: ${proposal.advisor.sunlightQuality.summary}`,
    304,
    118,
    240,
    fonts.regular,
    7.5,
    9.4,
    colors.muted
  );
  if (proposal.utilityBillUploaded) {
    drawTextBlock(
      page,
      "Utility bill uploaded for quote review.",
      304,
      88,
      240,
      fonts.bold,
      7.4,
      9.2,
      colors.green
    );
  }
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
    9.5,
    12,
    colors.muted
  );

  drawMetricCard(
    page,
    42,
    570,
    120,
    78,
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
    78,
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
    78,
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
    78,
    "20-year savings",
    formatMoneyMaybe(proposal.twentyYearSavings),
    "Modeled",
    colors.orange,
    fonts,
    colors
  );

  drawCard(page, 42, 332, 528, 196, colors);
  page.drawText("With Solar vs Without Solar", {
    x: 60,
    y: 502,
    size: 14,
    font: fonts.bold,
    color: colors.text,
  });
  drawCostComparison(page, 70, 370, 452, 96, proposal, fonts, colors);

  drawCard(page, 42, 190, 252, 106, colors);
  page.drawText("Estimated production", {
    x: 58,
    y: 266,
    size: 9,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(formatKwhMaybe(proposal.annualKwh), {
    x: 58,
    y: 239,
    size: 22,
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
    8.5,
    11,
    colors.muted
  );

  drawCard(page, 318, 190, 252, 106, colors);
  page.drawText("Environmental impact", {
    x: 334,
    y: 266,
    size: 9,
    font: fonts.bold,
    color: colors.muted,
  });
  page.drawText(formatLbsMaybe(proposal.annualImpactLbs), {
    x: 334,
    y: 239,
    size: 22,
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
    8.5,
    11,
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
    9.5,
    12,
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

  drawCard(page, 42, 184, 528, 242, colors);
  page.drawText("Estimated financing snapshot", {
    x: 60,
    y: 396,
    size: 14,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 422, 396, "Modeled", fonts, colors);

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
      label: "Net payback (after 30% tax credit)",
      primary: true,
      value: proposal.netPaybackYears ? `${proposal.netPaybackYears} yrs - PRIMARY` : "Unavailable",
    },
    { label: "Total 20-year cost with solar", value: formatMoneyMaybe(proposal.costWithSolar20Yr) },
    { label: "Total 20-year cost without solar", value: formatMoneyMaybe(proposal.costWithoutSolar20Yr) },
    { label: "Total 20-year savings", value: formatMoneyMaybe(proposal.twentyYearSavings) },
  ];

  rows.forEach((row, index) => {
    const y = 358 - index * 27;
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
      size: 9.5,
      font: row.primary ? fonts.bold : fonts.regular,
      color: row.primary ? colors.green : colors.muted,
    });
    page.drawText(row.value, {
      x: 430,
      y,
      size: 10,
      font: fonts.bold,
      color:
        row.value === "Unavailable" || row.value === "Estimate unavailable"
          ? colors.muted
          : row.primary
            ? colors.green
            : colors.text,
    });
  });

  drawTextBlock(
    page,
    "Net payback assumes the federal 30% Investment Tax Credit (ITC) is claimed in the year of installation.",
    60,
    166,
    455,
    fonts.regular,
    8.2,
    10.5,
    colors.muted
  );

  drawDisclaimer(page, 42, 122, fonts, colors);
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
    10,
    13,
    colors.muted
  );

  drawStep(page, 42, 566, "1", "Review your report", "Confirm that the modeled savings, roof area, and panel count look aligned with your goals.", fonts, colors);
  drawStep(page, 42, 456, "2", "Request a final installer review", "A licensed installer can verify roof condition, setbacks, electrical requirements, incentives, and final pricing.", fonts, colors);
  drawStep(page, 42, 346, "3", "Decide when you're ready", "Use this report as a starting point for a no-pressure solar conversation.", fonts, colors);

  drawCard(page, 342, 356, 228, 320, colors);
  page.drawText("Next Step", {
    x: 360,
    y: 644,
    size: 13,
    font: fonts.bold,
    color: colors.text,
  });
  drawSourceBadge(page, 360, 618, proposal.quoteRequested ? "Requested" : "Next Step", fonts, colors);
  page.drawText("Request Final Review", {
    x: 360,
    y: 596,
    size: 11,
    font: fonts.bold,
    color: colors.cyan,
  });
  drawTextBlock(
    page,
    proposal.quoteRequested
      ? "Your review request was received. A solar specialist can follow up with this report context."
      : "Use this report to discuss final design and pricing with a licensed installer.",
    360,
    576,
    176,
    fonts.regular,
    8.4,
    11,
    colors.muted
  );
  drawContactRow(page, 360, 540, "Email", proposal.email, fonts, colors);
  drawContactRow(page, 360, 502, "Report ID", proposal.id, fonts, colors);
  drawContactRow(page, 360, 464, "Website", "solar-leads-psi.vercel.app", fonts, colors);

  page.drawText("Open this report", {
    x: 360,
    y: 432,
    size: 9,
    font: fonts.bold,
    color: colors.muted,
  });
  if (assets.qrImage) {
    page.drawRectangle({ x: 360, y: 304, width: 88, height: 88, color: rgb(1, 1, 1) });
    page.drawImage(assets.qrImage, { x: 365, y: 309, width: 78, height: 78 });
  } else {
    drawCard(page, 360, 304, 88, 88, colors);
    page.drawText("QR unavailable", {
      x: 371,
      y: 344,
      size: 9,
      font: fonts.bold,
      color: colors.muted,
    });
  }
  drawTextBlock(
    page,
    "Scan to reopen or share your report link.",
    360,
    286,
    168,
    fonts.regular,
    8.5,
    11,
    colors.muted
  );

  drawCard(page, 42, 122, 528, 178, colors);
  page.drawText("Why this is an estimate", {
    x: 60,
    y: 268,
    size: 14,
    font: fonts.bold,
    color: colors.text,
  });
  const notes = [
    "Satellite imagery may not show recent roof changes, tree trimming, or new obstructions.",
    "Final panel placement depends on setbacks, fire code, roof condition, electrical service, and installer measurements.",
    "Savings depend on utility rates, usage, financing, incentives, and future energy costs.",
    "This is a preliminary estimate, not a binding installation contract.",
  ];
  notes.forEach((note, index) => drawBullet(page, 62, 242 - index * 24, note, fonts, colors));
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

  page.drawText("ARIZONA SOLAR AI", {
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
    y: 48,
    size: 7.5,
    font: fonts.regular,
    color: colors.muted,
    maxWidth: 360,
  });
  page.drawText(`Report ${proposal.id.slice(0, 8).toUpperCase()}`, {
    x: 454,
    y: 48,
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
  fonts: PdfFonts,
  colors: PdfColors,
  options: { compact?: boolean; showLegend?: boolean } = {}
) {
  drawCard(page, x, y, width, height, colors);
  page.drawRectangle({ x: x + 6, y: y + 6, width: width - 12, height: height - 12, color: colors.mapBg });

  if (image) {
    page.drawImage(image, {
      x: x + 6,
      y: y + 6,
      width: width - 12,
      height: height - 12,
      opacity: 0.9,
    });
    page.drawRectangle({ x: x + 6, y: y + 6, width: width - 12, height: height - 12, color: colors.bg, opacity: 0.08 });
    drawSelectedPropertyMarker(page, x, y, width, height, fonts, colors);
  } else {
    page.drawRectangle({
      x: x + 6,
      y: y + 6,
      width: width - 12,
      height: height - 12,
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

  page.drawRectangle({
    x: x + 18,
    y: y + height - 36,
    width: image ? 190 : 182,
    height: 22,
    color: colors.badgeFill,
    opacity: 0.9,
  });
  page.drawText(image ? "SATELLITE ROOF IMAGE" : "ROOF IMAGE UNAVAILABLE", {
    x: x + 30,
    y: y + height - 29,
    size: 7.5,
    font: fonts.bold,
    color: colors.text,
  });

  if (options.showLegend) {
    drawImageLegend(page, x + 20, y + 18, fonts, colors, Boolean(image));
  }
}

function drawSelectedPropertyMarker(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  fonts: PdfFonts,
  colors: PdfColors
) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  page.drawCircle({ x: cx, y: cy, size: 9, color: colors.cyan, opacity: 0.18 });
  page.drawCircle({ x: cx, y: cy, size: 4.2, borderColor: colors.cyan, borderWidth: 1.2, color: colors.bg, opacity: 0.72 });
  page.drawLine({ start: { x: cx - 14, y: cy }, end: { x: cx - 5, y: cy }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx + 5, y: cy }, end: { x: cx + 14, y: cy }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx, y: cy - 14 }, end: { x: cx, y: cy - 5 }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawLine({ start: { x: cx, y: cy + 5 }, end: { x: cx, y: cy + 14 }, color: colors.cyan, opacity: 0.75, thickness: 0.8 });
  page.drawRectangle({ x: cx + 12, y: cy + 12, width: 102, height: 18, color: colors.badgeFill, opacity: 0.86 });
  page.drawText("SELECTED HOME", {
    x: cx + 21,
    y: cy + 18,
    size: 6.6,
    font: fonts.bold,
    color: colors.text,
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
  drawCard(page, x, y, 270, 82, colors);
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
    size: 7,
    font: fonts.bold,
    color: colors.cyan,
  });
  drawTextBlock(page, value, x, y - 15, 170, fonts.bold, 9.2, 11, colors.text);
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
  page.drawText(label.toUpperCase(), {
    x: x + 10,
    y: y + height - 22,
    size: 6.6,
    font: fonts.bold,
    color: colors.muted,
  });
  drawTextBlock(
    page,
    value,
    x + 10,
    y + height - 42,
    width - 20,
    fonts.bold,
    value.length > 17 ? 10 : 14,
    15,
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
  const naturalWidth = Math.max(48, label.length * 5.8 + 14);
  const width = maxWidth ? Math.min(naturalWidth, maxWidth) : naturalWidth;
  let fontSize = 5.8;
  while (fonts.bold.widthOfTextAtSize(label.toUpperCase(), fontSize) > width - 12 && fontSize > 3.6) {
    fontSize -= 0.2;
  }
  const color =
    label === "Solar API"
      ? colors.cyan
      : label === "Modeled" || label === "Modeled from panel layout"
        ? colors.gold
        : label === "User-adjusted"
          ? colors.green
          : label === "Estimated"
            ? colors.orange
            : colors.slate;
  page.drawRectangle({
    x,
    y,
    width,
    height: 16,
    color,
    opacity: 0.16,
    borderColor: color,
    borderWidth: 0.6,
  });
  page.drawText(label.toUpperCase(), {
    x: x + 7,
    y: y + 5.2,
    size: fontSize,
    font: fonts.bold,
    color: colors.text,
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
  const width = Math.max(98, fonts.bold.widthOfTextAtSize(label, 7.8) + 20);
  page.drawRectangle({
    x,
    y,
    width,
    height: 24,
    color,
    opacity: 0.16,
    borderColor: color,
    borderWidth: 0.8,
  });
  page.drawText(label, {
    x: x + 10,
    y: y + 8,
    size: 7.8,
    font: fonts.bold,
    color: colors.text,
  });
}

function getLeadScorePdfColor(label: LeadScoreLabel, colors: PdfColors) {
  if (label === "Hot Lead") {
    return colors.orange;
  }

  if (label === "Warm Lead") {
    return colors.gold;
  }

  return colors.muted;
}

function drawImageLegend(
  page: PDFPage,
  x: number,
  y: number,
  fonts: PdfFonts,
  colors: PdfColors,
  hasImage: boolean
) {
  page.drawRectangle({ x, y, width: 208, height: 70, color: colors.bg, opacity: 0.72 });
  page.drawText("LEGEND", {
    x: x + 10,
    y: y + 54,
    size: 6.2,
    font: fonts.bold,
    color: colors.cyan,
  });
  const items = [
    ["Satellite", hasImage ? "Selected property imagery" : "Image unavailable", colors.cyan],
    ["Solar API", "Roof and solar metrics", colors.gold],
    ["Modeled", "Savings and system assumptions", colors.green],
  ] as const;
  items.forEach(([name, label, color], index) => {
    const itemY = y + 38 - index * 15;
    page.drawRectangle({ x: x + 10, y: itemY, width: 8, height: 8, color, opacity: 0.75 });
    page.drawText(`${name}: ${label}`, {
      x: x + 24,
      y: itemY + 1,
      size: 7.2,
      font: fonts.regular,
      color: colors.text,
    });
  });
}

function drawDisclaimer(page: PDFPage, x: number, y: number, fonts: PdfFonts, colors: PdfColors) {
  drawCard(page, x, y, 528, 42, colors, colors.gold);
  drawTextBlock(
    page,
    "This is a preliminary solar estimate. Final panel placement, incentives, pricing, and savings require installer confirmation.",
    x + 16,
    y + 25,
    490,
    fonts.regular,
    8.6,
    11,
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
  size = 8.5
) {
  page.drawCircle({ x: x + 3, y: y + 3, size: 2.5, color: colors.cyan, opacity: 0.85 });
  drawTextBlock(page, text, x + 13, y + 8, 470, fonts.regular, size, size + 3, colors.muted);
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
    borderWidth: borderColor ? 1.1 : 0.7,
  });
}

function drawMapPattern(page: PDFPage, x: number, y: number, width: number, height: number, colors: PdfColors) {
  page.drawRectangle({ x, y, width, height, color: colors.mapBg });
  for (let index = 0; index < 9; index += 1) {
    page.drawRectangle({
      x: x + 18 + index * 54,
      y: y + 24 + (index % 3) * 28,
      width: 42,
      height: 22,
      color: index % 2 ? colors.slate : colors.gold,
      opacity: 0.18,
    });
  }
  page.drawLine({ start: { x, y: y + height * 0.62 }, end: { x: x + width, y: y + height * 0.42 }, thickness: 22, color: colors.line, opacity: 0.12 });
  page.drawLine({ start: { x: x + width * 0.2, y }, end: { x: x + width * 0.74, y: y + height }, thickness: 14, color: colors.line, opacity: 0.1 });
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

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });
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
    muted: rgb(0.62, 0.69, 0.78),
    line: rgb(0.2, 0.28, 0.36),
    cyan: rgb(0.25, 0.86, 0.95),
    blue: rgb(0.22, 0.52, 0.96),
    green: rgb(0.25, 0.83, 0.58),
    gold: rgb(0.96, 0.72, 0.23),
    orange: rgb(0.94, 0.42, 0.16),
    slate: rgb(0.4, 0.46, 0.54),
    badgeFill: rgb(0.12, 0.18, 0.24),
  };
}

async function loadRoofImage(pdf: PDFDocument, proposal: ProposalData) {
  const mapsKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

  if (mapsKey) {
    try {
      const coordinates =
        proposal.lat && proposal.lng
          ? { lat: proposal.lat, lng: proposal.lng }
          : await geocodeReportAddress(proposal.address, mapsKey);

      if (!coordinates) {
        return null;
      }

      const params = new URLSearchParams({
        center: `${coordinates.lat},${coordinates.lng}`,
        zoom: "20",
        size: "640x360",
        scale: "2",
        maptype: "satellite",
        format: "png",
        key: mapsKey,
      });
      params.append("style", "feature:all|element:labels|visibility:off");
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
      );

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("png")) {
          return await pdf.embedPng(bytes);
        }

        return await pdf.embedJpg(bytes);
      }
    } catch {
      // The PDF should never fall back to a generic home photo.
      // A clearly labeled unavailable state is rendered instead.
    }
  }

  return null;
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
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      status?: string;
    };
    const location = payload.results?.[0]?.geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    if (payload.status !== "OK" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return { lat, lng };
  } catch {
    return null;
  }
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
