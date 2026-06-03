import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Resend } from "resend";
import type { SolarReport } from "@/lib/solar-report";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildReportPdfUrl } from "@/lib/report-access";

type ReportEmailBody = {
  leadId?: string;
  name?: string;
  email?: string;
  address?: string;
  monthlyBill?: number;
  report?: SolarReport;
  utilityBillUploaded?: boolean;
};

const resendApiKey = process.env.RESEND_API_KEY;
const resendFromEmail =
  process.env.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "reports@solartelligence.com";

export async function POST(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:report-email",
      limit: 10,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many report emails. Please try again soon." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    if (!resendApiKey || !resendFromEmail) {
      return NextResponse.json(
        {
          message: "Local report ready. Email delivery is off in dev.",
          skipped: true,
        },
        { status: 200 }
      );
    }

    const body = (await request.json()) as ReportEmailBody;

    if (
      !body.email ||
      !body.address ||
      !body.monthlyBill ||
      !isCompleteReport(body.report)
    ) {
      return NextResponse.json(
        { message: "Missing required Solar API report fields." },
        { status: 400 }
      );
    }

    const report = body.report;
    const reportUrl = body.leadId
      ? buildReportPdfUrl(body.leadId, { absolute: true })
      : null;
    const pdfBuffer = await buildReportPdfAttachment({
      address: body.address,
      email: body.email,
      monthlyBill: body.monthlyBill,
      report,
      utilityBillUploaded: Boolean(body.utilityBillUploaded),
    });
    const resend = new Resend(resendApiKey);

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; background:#05070b; color:#e5eefb; padding:32px;">
        <div style="max-width:720px; margin:0 auto; background:linear-gradient(135deg, rgba(17,24,39,0.95), rgba(10,15,24,0.95)); border:1px solid rgba(148,163,184,0.18); border-radius:28px; overflow:hidden;">
          <div style="padding:28px 32px; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:12px; letter-spacing:0.32em; text-transform:uppercase; color:#67e8f9;">AI Solar Report</div>
            <h1 style="margin:14px 0 0; font-size:28px; line-height:1.1;">Your PDF report is attached${body.name ? `, ${escapeHtml(body.name)}` : ""}.</h1>
            <p style="margin:12px 0 0; color:#cbd5e1; font-size:15px; line-height:1.6;">We generated a tailored solar preview for ${escapeHtml(body.address)}.</p>
          </div>
          <div style="padding:24px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate; border-spacing:12px;">
              <tr>
                <td style="width:50%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:18px;">
                  <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; color:#67e8f9;">Estimated savings</div>
                  <div style="margin-top:10px; font-size:30px; font-weight:700;">${money(report.annualSavings)}</div>
                  <div style="margin-top:8px; font-size:14px; color:#cbd5e1;">Projected annual utility reduction.</div>
                </td>
                <td style="width:50%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:18px;">
                  <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; color:#67e8f9;">Estimated ROI</div>
                  <div style="margin-top:10px; font-size:30px; font-weight:700;">${report.estimatedRoiYears} years</div>
                  <div style="margin-top:8px; font-size:14px; color:#cbd5e1;">Estimated payback period for the system.</div>
                </td>
              </tr>
              <tr>
                <td style="width:50%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:18px;">
                  <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; color:#67e8f9;">Environmental impact</div>
                  <div style="margin-top:10px; font-size:30px; font-weight:700;">${report.annualImpactLbs.toLocaleString()} lbs</div>
                  <div style="margin-top:8px; font-size:14px; color:#cbd5e1;">Approximate annual CO2 reduction.</div>
                </td>
                <td style="width:50%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:18px;">
                  <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; color:#67e8f9;">Energy offset</div>
                  <div style="margin-top:10px; font-size:30px; font-weight:700;">${report.annualEnergyOffset}%</div>
                  <div style="margin-top:8px; font-size:14px; color:#cbd5e1;">Estimated household energy covered by solar.</div>
                </td>
              </tr>
            </table>
            <div style="margin-top:20px; padding:18px; border-radius:20px; background:rgba(103,232,249,0.08); border:1px solid rgba(103,232,249,0.15);">
              <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; color:#67e8f9;">Selected address</div>
              <div style="margin-top:8px; font-size:16px; color:#fff;">${escapeHtml(body.address)}</div>
              <div style="margin-top:6px; font-size:14px; color:#cbd5e1;">Sent to ${escapeHtml(body.email)}</div>
            </div>
            <div style="margin-top:16px; font-size:13px; line-height:1.6; color:#cbd5e1;">
              ${body.utilityBillUploaded ? "Utility bill uploaded for quote review. " : ""}
              Your PDF copy is attached to this email.${reportUrl ? ` You can also download it here: <a href="${escapeHtml(reportUrl)}" style="color:#67e8f9;">View PDF report</a>.` : ""} This preliminary estimate is not a final installation quote.
            </div>
          </div>
        </div>
      </div>
    `;

    const subject = `Your AI solar report for ${body.address}`;
    const text = [
      `Your AI solar report is ready for ${body.address}.`,
      `Estimated annual savings: ${money(report.annualSavings)}`,
      `Estimated ROI: ${report.estimatedRoiYears} years`,
      `Environmental impact: ${report.annualImpactLbs.toLocaleString()} lbs CO2`,
      body.utilityBillUploaded
        ? "Utility bill uploaded for quote review."
        : "No utility bill was uploaded.",
      "Your PDF copy is attached to this email.",
      reportUrl ? `Download link: ${reportUrl}` : "",
      "",
      "Thanks for requesting the report.",
    ]
      .filter(Boolean)
      .join("\n");

    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: body.email,
      subject,
      text,
      html,
      attachments: [
        {
          filename: "solartelligence-report.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    if (error) {
      return NextResponse.json(
        {
          message: "Report ready locally. Email send skipped.",
          skipped: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      message: "Your AI solar report has been emailed.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unexpected email failure.",
      },
      { status: 500 }
    );
  }
}

async function buildReportPdfAttachment({
  address,
  email,
  monthlyBill,
  report,
  utilityBillUploaded,
}: {
  address: string;
  email: string;
  monthlyBill: number;
  report: SolarReport;
  utilityBillUploaded: boolean;
}) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const detail = pdf.addPage([612, 792]);

  const colors = {
    accent: rgb(0.12, 0.66, 0.82),
    accentSoft: rgb(0.92, 0.98, 0.99),
    amber: rgb(0.77, 0.56, 0.16),
    ink: rgb(0.12, 0.16, 0.22),
    line: rgb(0.85, 0.89, 0.93),
    muted: rgb(0.43, 0.48, 0.55),
    paper: rgb(1, 1, 1),
    success: rgb(0.16, 0.55, 0.33),
  };

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: colors.paper });
  page.drawRectangle({ x: 0, y: 708, width: 612, height: 84, color: colors.accentSoft });
  page.drawText("ARIZONA SOLAR AI", {
    x: 36,
    y: 742,
    size: 10,
    font: bold,
    color: colors.accent,
  });
  page.drawText("Preliminary AI Solar Report", {
    x: 36,
    y: 676,
    size: 30,
    font: bold,
    color: colors.ink,
  });
  page.drawText(address, {
    x: 36,
    y: 646,
    size: 11,
    font: regular,
    color: colors.muted,
    maxWidth: 480,
    lineHeight: 14,
  });
  page.drawText(`Sent to ${email}`, {
    x: 36,
    y: 612,
    size: 9,
    font: regular,
    color: colors.muted,
  });

  drawPdfMetric(page, 36, 512, 160, "Annual savings", money(report.annualSavings), colors.accent, bold);
  drawPdfMetric(page, 226, 512, 160, "Panel count", `${report.panelCount}`, colors.success, bold);
  drawPdfMetric(page, 416, 512, 160, "Estimated ROI", `${report.estimatedRoiYears} yrs`, colors.amber, bold);

  page.drawText("Report notes", {
    x: 36,
    y: 444,
    size: 14,
    font: bold,
    color: colors.ink,
  });
  page.drawText(
    "This PDF is a preliminary solar estimate generated from the selected roof model and submitted monthly bill. Final panel placement, incentives, pricing, utility rules, and savings require installer confirmation.",
    {
      x: 36,
      y: 420,
      size: 10,
      font: regular,
      color: colors.muted,
      maxWidth: 520,
      lineHeight: 14,
    }
  );

  page.drawRectangle({
    x: 36,
    y: 284,
    width: 540,
    height: 90,
    color: colors.accentSoft,
    borderColor: colors.line,
    borderWidth: 1,
  });
  page.drawText("Monthly bill input", {
    x: 54,
    y: 342,
    size: 9,
    font: bold,
    color: colors.muted,
  });
  page.drawText(money(monthlyBill), {
    x: 54,
    y: 314,
    size: 24,
    font: bold,
    color: colors.ink,
  });
  page.drawText("Used only to tune the modeled savings in this report.", {
    x: 220,
    y: 322,
    size: 10,
    font: regular,
    color: colors.muted,
    maxWidth: 300,
  });
  if (utilityBillUploaded) {
    page.drawText("Utility bill uploaded for quote review.", {
      x: 220,
      y: 300,
      size: 10,
      font: bold,
      color: colors.success,
      maxWidth: 300,
    });
  }

  detail.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: colors.paper });
  detail.drawRectangle({ x: 0, y: 724, width: 612, height: 68, color: colors.accentSoft });
  detail.drawText("Estimate Summary", {
    x: 36,
    y: 750,
    size: 22,
    font: bold,
    color: colors.ink,
  });
  drawPdfRow(detail, 36, 650, "Estimated annual savings", money(report.annualSavings), bold, regular, colors);
  drawPdfRow(detail, 36, 610, "Estimated annual CO2 impact", `${report.annualImpactLbs.toLocaleString()} lbs`, bold, regular, colors);
  drawPdfRow(detail, 36, 570, "Estimated energy offset", `${report.annualEnergyOffset}%`, bold, regular, colors);
  drawPdfRow(detail, 36, 530, "Modeled payback period", `${report.estimatedRoiYears} years`, bold, regular, colors);

  detail.drawText("Data handling", {
    x: 36,
    y: 456,
    size: 14,
    font: bold,
    color: colors.ink,
  });
  detail.drawText(
    utilityBillUploaded
      ? "This report email was generated from the saved report record, submitted monthly bill, and uploaded bill status. The estimate remains preliminary until installer confirmation."
      : "This report email was generated from the saved report record and submitted monthly bill. The estimate remains preliminary until installer confirmation.",
    {
      x: 36,
      y: 432,
      size: 10,
      font: regular,
      color: colors.muted,
      maxWidth: 520,
      lineHeight: 14,
    }
  );

  return Buffer.from(await pdf.save());
}

function drawPdfMetric(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  accent: ReturnType<typeof rgb>,
  bold: import("pdf-lib").PDFFont
) {
  page.drawRectangle({
    x,
    y,
    width,
    height: 72,
    color: rgb(1, 1, 1),
    borderColor: accent,
    borderWidth: 1,
  });
  page.drawText(label.toUpperCase(), {
    x: x + 12,
    y: y + 48,
    size: 7.5,
    font: bold,
    color: accent,
  });
  page.drawText(value, {
    x: x + 12,
    y: y + 18,
    size: 18,
    font: bold,
    color: rgb(0.12, 0.16, 0.22),
  });
}

function drawPdfRow(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  label: string,
  value: string,
  bold: import("pdf-lib").PDFFont,
  regular: import("pdf-lib").PDFFont,
  colors: {
    ink: ReturnType<typeof rgb>;
    line: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
  }
) {
  page.drawLine({
    start: { x, y: y - 10 },
    end: { x: x + 540, y: y - 10 },
    thickness: 0.75,
    color: colors.line,
  });
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: regular,
    color: colors.muted,
  });
  page.drawText(value, {
    x: x + 330,
    y,
    size: 14,
    font: bold,
    color: colors.ink,
  });
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function isCompleteReport(report: unknown): report is SolarReport {
  if (!report || typeof report !== "object") {
    return false;
  }

  const candidate = report as Partial<Record<keyof SolarReport, unknown>>;
  return (
    Number(candidate.annualSavings) > 0 &&
    Number(candidate.panelCount) > 0 &&
    Number.isFinite(Number(candidate.estimatedRoiYears)) &&
    Number.isFinite(Number(candidate.annualImpactLbs)) &&
    Number.isFinite(Number(candidate.annualEnergyOffset))
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
