import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildSolarReport } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifyReportSignature } from "@/lib/report-access";

type Color = ReturnType<typeof rgb>;

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

    const signatureCheck = verifyReportSignature(leadId, exp, token);
    if (!signatureCheck.ok) {
      return NextResponse.json(
        {
          message: signatureCheck.expired
            ? "This report link has expired."
            : "This report link is invalid.",
        },
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, name, email, phone, address, monthly_bill, created_at")
      .eq("id", leadId)
      .single();

    if (error || !lead) {
      return NextResponse.json(
        { message: error?.message || "Lead not found." },
        { status: 404 }
      );
    }

    const report = buildSolarReport(lead.monthly_bill);
    const pdf = await PDFDocument.create();
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);

    const colors = {
      paper: rgb(1, 1, 1),
      ink: rgb(0.12, 0.16, 0.21),
      muted: rgb(0.43, 0.48, 0.55),
      line: rgb(0.85, 0.89, 0.93),
      accent: rgb(0.16, 0.67, 0.82),
      accentSoft: rgb(0.93, 0.98, 0.99),
      success: rgb(0.17, 0.57, 0.34),
      amber: rgb(0.77, 0.57, 0.18),
      slate: rgb(0.21, 0.27, 0.34),
    } satisfies Record<string, Color>;

    const cover = pdf.addPage([612, 792]);
    const detail = pdf.addPage([612, 792]);
    const financing = pdf.addPage([612, 792]);

    drawCoverPage({ page: cover, lead, report, bold, regular, colors });
    drawDetailPage({ page: detail, lead, report, bold, regular, colors });
    drawFinancingPage({ page: financing, lead, report, bold, regular, colors });

    const bytes = await pdf.save();

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ai-solar-report-${leadId}.pdf"`,
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

function drawCoverPage({
  page,
  lead,
  report,
  bold,
  regular,
  colors,
}: {
  page: import("pdf-lib").PDFPage;
  lead: {
    id: string;
    name: string;
    address: string;
    created_at: string;
    monthly_bill: number;
  };
  report: ReturnType<typeof buildSolarReport>;
  bold: import("pdf-lib").PDFFont;
  regular: import("pdf-lib").PDFFont;
  colors: Record<string, Color>;
}) {
  const width = page.getWidth();
  const height = page.getHeight();

  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.paper });
  page.drawRectangle({ x: 0, y: height - 84, width, height: 84, color: colors.accentSoft });
  page.drawRectangle({ x: 36, y: 708, width: 134, height: 20, color: colors.accent });

  page.drawText("ADDRESS-TO-ROOF", {
    x: 44,
    y: 714,
    size: 8.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("AI Solar Report", {
    x: 36,
    y: 666,
    size: 28,
    font: bold,
    color: colors.ink,
  });
  page.drawText("Premium homeowner estimate and install preview", {
    x: 36,
    y: 642,
    size: 12,
    font: regular,
    color: colors.muted,
  });
  page.drawText(lead.name, {
    x: 36,
    y: 602,
    size: 18,
    font: bold,
    color: colors.ink,
  });
  page.drawText(lead.address, {
    x: 36,
    y: 582,
    size: 10.5,
    font: regular,
    color: colors.muted,
    maxWidth: 300,
    lineHeight: 13,
  });
  page.drawText(`Generated ${new Date(lead.created_at).toLocaleDateString("en-US")}`, {
    x: 36,
    y: 564,
    size: 8.5,
    font: regular,
    color: colors.muted,
  });

  drawPill(page, 36, 512, 132, 24, colors.accentSoft, colors.accent, bold, "Modeled estimate");
  drawPill(page, 176, 512, 146, 24, rgb(0.95, 0.98, 0.99), colors.ink, bold, "Arizona homeowner");

  page.drawText("At a glance", {
    x: 36,
    y: 476,
    size: 12,
    font: bold,
    color: colors.ink,
  });

  drawMetricMini(page, 36, 414, 148, 58, colors.accent, "Annual savings", formatMoney(report.annualSavings), bold);
  drawMetricMini(page, 198, 414, 148, 58, colors.success, "Estimated ROI", `${report.estimatedRoiYears} yrs`, bold);
  drawMetricMini(page, 360, 414, 148, 58, colors.amber, "Carbon offset", `${report.annualImpactLbs.toLocaleString()} lbs`, bold);

  page.drawText("Install story", {
    x: 36,
    y: 372,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawText(
    "The system is placed on the strongest garage roof plane, with enough surface area for a realistic and balanced rooftop layout.",
    {
      x: 36,
      y: 350,
      size: 10,
      font: regular,
      color: colors.muted,
      maxWidth: 290,
      lineHeight: 13,
    }
  );

  drawRoofIllustration(page, 326, 294, 250, 186, colors, bold);

  page.drawText("What's inside", {
    x: 36,
    y: 294,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  const bullets = [
    "Cover page with homeowner summary",
    "Financial summary page with charting",
    "Financing options page for sales conversations",
  ];
  bullets.forEach((bullet, index) => {
    const y = 272 - index * 20;
    page.drawRectangle({ x: 38, y: y + 2, width: 6, height: 6, color: colors.accent });
    page.drawText(bullet, {
      x: 52,
      y,
      size: 10,
      font: regular,
      color: colors.ink,
    });
  });

  page.drawRectangle({ x: 36, y: 96, width: 540, height: 64, color: colors.accentSoft });
  page.drawText("Estimated savings", {
    x: 52,
    y: 136,
    size: 9,
    font: bold,
    color: colors.muted,
  });
  page.drawText(formatMoney(report.annualSavings), {
    x: 52,
    y: 112,
    size: 22,
    font: bold,
    color: colors.ink,
  });
  page.drawText("Modeled from the submitted monthly bill", {
    x: 220,
    y: 120,
    size: 10,
    font: regular,
    color: colors.muted,
  });
  page.drawText(`Report ID: ${lead.id}`, {
    x: 36,
    y: 58,
    size: 8,
    font: regular,
    color: colors.muted,
  });
}

function drawDetailPage({
  page,
  lead,
  report,
  bold,
  regular,
  colors,
}: {
  page: import("pdf-lib").PDFPage;
  lead: {
    name: string;
    email: string;
    phone: string;
    address: string;
    monthly_bill: number;
  };
  report: ReturnType<typeof buildSolarReport>;
  bold: import("pdf-lib").PDFFont;
  regular: import("pdf-lib").PDFFont;
  colors: Record<string, Color>;
}) {
  const width = page.getWidth();
  const height = page.getHeight();

  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.paper });
  page.drawRectangle({ x: 0, y: height - 56, width, height: 56, color: colors.accentSoft });

  page.drawText("Detailed Estimate", {
    x: 36,
    y: 740,
    size: 20,
    font: bold,
    color: colors.ink,
  });
  page.drawText("Financial model and homeowner-ready summary", {
    x: 36,
    y: 720,
    size: 10,
    font: regular,
    color: colors.muted,
  });

  drawMetricBarChart(page, 36, 614, 540, 86, report, colors, bold, regular);

  page.drawText("Summary metrics", {
    x: 36,
    y: 588,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawText(
    "The chart above compares the modeled annual savings, estimated payback period, and carbon offset at a glance.",
    {
      x: 36,
      y: 570,
      size: 9.5,
      font: regular,
      color: colors.muted,
      maxWidth: 540,
    }
  );

  page.drawRectangle({
    x: 36,
    y: 432,
    width: 540,
    height: 116,
    color: rgb(1, 1, 1),
    borderColor: colors.line,
    borderWidth: 1,
  });
  page.drawText("System snapshot", {
    x: 50,
    y: 524,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  drawLabelValue(page, 50, 494, "Panel count", `${report.panelCount} panels`, bold, regular, colors.ink, colors.muted);
  drawLabelValue(page, 50, 472, "Monthly bill", formatMoney(lead.monthly_bill), bold, regular, colors.ink, colors.muted);
  drawLabelValue(page, 50, 450, "Energy offset", `${report.annualEnergyOffset}%`, bold, regular, colors.ink, colors.muted);
  drawLabelValue(page, 300, 494, "Roof fit", "Garage roof plane", bold, regular, colors.ink, colors.muted);
  drawLabelValue(page, 300, 472, "Homeowner", lead.name, bold, regular, colors.ink, colors.muted);
  drawLabelValue(page, 300, 450, "Install style", "Premium rooftop preview", bold, regular, colors.ink, colors.muted);

  page.drawText("Contact and next steps", {
    x: 36,
    y: 396,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawRectangle({
    x: 36,
    y: 258,
    width: 540,
    height: 118,
    color: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 1,
  });
  const steps = [
    "Email the PDF report to the homeowner immediately.",
    "Follow up with a warm reminder the next day.",
    "Keep the install conversation alive with a consult-ready summary.",
  ];
  steps.forEach((step, index) => {
    const y = 334 - index * 26;
    page.drawRectangle({ x: 52, y: y + 2, width: 6, height: 6, color: colors.accent });
    page.drawText(step, {
      x: 64,
      y,
      size: 10,
      font: regular,
      color: colors.ink,
      maxWidth: 490,
      lineHeight: 13,
    });
  });

  page.drawText("Why this format prints well", {
    x: 36,
    y: 220,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawText(
    "This page is intentionally light, structured, and easy to scan so it feels good on paper or as a PDF attachment.",
    {
      x: 36,
      y: 200,
      size: 9.5,
      font: regular,
      color: colors.muted,
      maxWidth: 540,
      lineHeight: 13,
    }
  );

  page.drawLine({
    start: { x: 36, y: 150 },
    end: { x: 576, y: 150 },
    thickness: 0.75,
    color: colors.line,
  });
  page.drawText("Address-to-Roof Solar Preview", {
    x: 36,
    y: 132,
    size: 8,
    font: bold,
    color: colors.muted,
  });
  page.drawText(`${lead.email} | ${lead.phone}`, {
    x: 396,
    y: 132,
    size: 8,
    font: regular,
    color: colors.muted,
  });
}

function drawFinancingPage({
  page,
  lead,
  report,
  bold,
  regular,
  colors,
}: {
  page: import("pdf-lib").PDFPage;
  lead: {
    name: string;
    address: string;
    monthly_bill: number;
  };
  report: ReturnType<typeof buildSolarReport>;
  bold: import("pdf-lib").PDFFont;
  regular: import("pdf-lib").PDFFont;
  colors: Record<string, Color>;
}) {
  const width = page.getWidth();
  const height = page.getHeight();
  const monthlySavings = Math.max(1, Math.round(report.annualSavings / 12));

  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.paper });
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: colors.accentSoft });

  page.drawText("Financing Options", {
    x: 36,
    y: 736,
    size: 20,
    font: bold,
    color: colors.ink,
  });
  page.drawText("Illustrative options based on the modeled savings profile", {
    x: 36,
    y: 716,
    size: 10,
    font: regular,
    color: colors.muted,
  });
  page.drawText(lead.name, {
    x: 36,
    y: 690,
    size: 11,
    font: bold,
    color: colors.ink,
  });
  page.drawText(lead.address, {
    x: 36,
    y: 674,
    size: 9,
    font: regular,
    color: colors.muted,
    maxWidth: 400,
  });

  drawFinanceCard(
    page,
    36,
    554,
    160,
    96,
    colors.accent,
    "Cash purchase",
    "Lowest total cost",
    `${formatMoney(report.annualSavings)} / yr savings`,
    "Best for homeowners who want maximum long-term return and no monthly finance payment.",
    bold,
    regular,
    colors
  );
  drawFinanceCard(
    page,
    226,
    554,
    160,
    96,
    colors.success,
    "12-year loan",
    `~${formatMoney(monthlySavings)} / mo`,
    `${report.estimatedRoiYears} yr modeled ROI`,
    "Balanced monthly payment option that can be structured around the modeled bill reduction.",
    bold,
    regular,
    colors
  );
  drawFinanceCard(
    page,
    416,
    554,
    160,
    96,
    colors.amber,
    "15-year loan",
    "Lower monthly payment",
    "Flexible budget fit",
    "Designed for homeowners who want a gentler payment profile with still-strong savings.",
    bold,
    regular,
    colors
  );

  page.drawText("Payment snapshot", {
    x: 36,
    y: 516,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawRectangle({
    x: 36,
    y: 414,
    width: 540,
    height: 86,
    color: rgb(1, 1, 1),
    borderColor: colors.line,
    borderWidth: 1,
  });

  const comparisons = [
    { label: "Estimated monthly savings", value: formatMoney(monthlySavings), accent: colors.accent, widthPct: 100 },
    { label: "Modeled ROI timing", value: `${report.estimatedRoiYears} years`, accent: colors.success, widthPct: Math.max(35, Math.min(100, 100 - report.estimatedRoiYears * 8)) },
    { label: "Illustrative payment fit", value: "Depends on provider terms", accent: colors.amber, widthPct: 75 },
  ];

  comparisons.forEach((item, index) => {
    const y = 470 - index * 22;
    page.drawText(item.label, {
      x: 50,
      y,
      size: 9,
      font: regular,
      color: colors.ink,
    });
    page.drawRectangle({ x: 250, y: y - 2, width: 190, height: 10, color: rgb(0.93, 0.95, 0.97) });
    page.drawRectangle({
      x: 250,
      y: y - 2,
      width: Math.round((190 * item.widthPct) / 100),
      height: 10,
      color: item.accent,
    });
    page.drawText(item.value, {
      x: 454,
      y,
      size: 9,
      font: bold,
      color: colors.ink,
    });
  });

  page.drawText("Financing note", {
    x: 36,
    y: 374,
    size: 12,
    font: bold,
    color: colors.ink,
  });
  page.drawText(
    "The financing examples above are illustrative and should be confirmed with the installer or lender. Actual terms will vary based on credit, lender, incentives, and final system design.",
    {
      x: 36,
      y: 352,
      size: 9.5,
      font: regular,
      color: colors.muted,
      maxWidth: 540,
      lineHeight: 13,
    }
  );

  page.drawRectangle({ x: 36, y: 210, width: 540, height: 96, color: colors.accentSoft });
  page.drawText("Why financing is included", {
    x: 52,
    y: 284,
    size: 9,
    font: bold,
    color: colors.muted,
  });
  page.drawText(
    "This keeps the report useful in a real sales conversation by showing the homeowner how the project can be framed as a monthly payment decision, not just a total price.",
    {
      x: 52,
      y: 262,
      size: 10,
      font: regular,
      color: colors.ink,
      maxWidth: 500,
      lineHeight: 13,
    }
  );
  page.drawText("Modeled from the submitted bill and savings estimate", {
    x: 52,
    y: 238,
    size: 9,
    font: bold,
    color: colors.accent,
  });
}

function drawRoofIllustration(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: Record<string, Color>,
  bold: import("pdf-lib").PDFFont
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.99, 0.995, 1),
    borderColor: colors.line,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: x + 16,
    y: y + 26,
    width: width - 32,
    height: height - 52,
    color: rgb(0.93, 0.95, 0.97),
  });
  page.drawRectangle({ x: x + 30, y: y + 58, width: 74, height: 34, color: colors.slate });
  page.drawRectangle({ x: x + 116, y: y + 58, width: 102, height: 34, color: colors.slate });
  page.drawRectangle({ x: x + 42, y: y + 67, width: 52, height: 10, color: colors.accent });
  page.drawRectangle({ x: x + 130, y: y + 67, width: 72, height: 10, color: colors.accent });
  page.drawRectangle({ x: x + 58, y: y + 22, width: 124, height: 20, color: colors.success });
  page.drawText("ROOFTOP ARRAY", {
    x: x + 68,
    y: y + 28,
    size: 8,
    font: bold,
    color: rgb(1, 1, 1),
  });
}

function drawFinanceCard(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: Color,
  heading: string,
  value: string,
  subvalue: string,
  description: string,
  bold: import("pdf-lib").PDFFont,
  regular: import("pdf-lib").PDFFont,
  colors: Record<string, Color>
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: accent,
    borderWidth: 1,
  });
  page.drawRectangle({ x: x + 12, y: y + height - 16, width: 36, height: 4, color: accent });
  page.drawText(heading, {
    x: x + 12,
    y: y + 72,
    size: 8.5,
    font: bold,
    color: colors.muted,
  });
  page.drawText(value, {
    x: x + 12,
    y: y + 48,
    size: 14,
    font: bold,
    color: colors.ink,
  });
  page.drawText(subvalue, {
    x: x + 12,
    y: y + 34,
    size: 8.5,
    font: regular,
    color: accent,
  });
  page.drawText(description, {
    x: x + 12,
    y: y + 12,
    size: 7.5,
    font: regular,
    color: colors.muted,
    maxWidth: width - 24,
    lineHeight: 10,
  });
}

function drawMetricMini(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: Color,
  label: string,
  value: string,
  bold: import("pdf-lib").PDFFont
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: accent,
    borderWidth: 1,
  });
  page.drawText(label.toUpperCase(), {
    x: x + 10,
    y: y + 40,
    size: 7,
    font: bold,
    color: accent,
  });
  page.drawText(value, {
    x: x + 10,
    y: y + 15,
    size: 14,
    font: bold,
    color: rgb(0.12, 0.16, 0.21),
  });
}

function drawPill(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: Color,
  textColor: Color,
  bold: import("pdf-lib").PDFFont,
  text: string
) {
  page.drawRectangle({ x, y, width, height, color: fill });
  page.drawText(text, {
    x: x + 10,
    y: y + 7,
    size: 8,
    font: bold,
    color: textColor,
  });
}

function drawLabelValue(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  label: string,
  value: string,
  bold: import("pdf-lib").PDFFont,
  regular: import("pdf-lib").PDFFont,
  ink: Color,
  muted: Color
) {
  page.drawText(label, { x, y, size: 8, font: bold, color: muted });
  page.drawText(value, { x: x + 90, y, size: 9.5, font: regular, color: ink });
}

function drawMetricBarChart(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  report: ReturnType<typeof buildSolarReport>,
  colors: Record<string, Color>,
  bold: import("pdf-lib").PDFFont,
  regular: import("pdf-lib").PDFFont
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: colors.line,
    borderWidth: 1,
  });

  const bars = [
    {
      label: "Savings",
      value: report.annualSavings,
      max: Math.max(report.annualSavings, 8000),
      color: colors.accent,
    },
    {
      label: "ROI",
      value: Math.max(0, 10 - report.estimatedRoiYears),
      max: 10,
      color: colors.success,
    },
    {
      label: "CO2",
      value: report.annualImpactLbs,
      max: Math.max(report.annualImpactLbs, 10000),
      color: colors.amber,
    },
  ];

  page.drawText("Modeled impact", {
    x: x + 14,
    y: y + height - 18,
    size: 9,
    font: bold,
    color: colors.muted,
  });

  bars.forEach((bar, index) => {
    const barY = y + 18 + index * 20;
    const barWidth = Math.max(0, Math.round(((width - 150) * bar.value) / bar.max));
    page.drawText(bar.label, {
      x: x + 14,
      y: barY + 2,
      size: 9,
      font: regular,
      color: colors.ink,
    });
    page.drawRectangle({
      x: x + 92,
      y: barY,
      width: width - 132,
      height: 10,
      color: rgb(0.93, 0.95, 0.97),
    });
    page.drawRectangle({
      x: x + 92,
      y: barY,
      width: barWidth,
      height: 10,
      color: bar.color,
    });
  });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
