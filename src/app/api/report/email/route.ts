import { NextResponse } from "next/server";
import { Resend } from "resend";
import type { SolarReport } from "@/lib/solar-report";
import { buildReportPdfUrl } from "@/lib/report-access";
import { enforceRateLimit } from "@/lib/rate-limit";

type ReportEmailBody = {
  leadId?: string;
  name?: string;
  email?: string;
  address?: string;
  monthlyBill?: number;
  report?: SolarReport;
};

const resendApiKey = process.env.RESEND_API_KEY;
const resendFromEmail = process.env.RESEND_FROM_EMAIL;

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
      !body.name ||
      !body.address ||
      !body.monthlyBill ||
      !body.leadId ||
      !isCompleteReport(body.report)
    ) {
      return NextResponse.json(
        { message: "Missing required Solar API report fields." },
        { status: 400 }
      );
    }

    const report = body.report;
    const reportUrl = buildReportPdfUrl(body.leadId, { absolute: true });
    const resend = new Resend(resendApiKey);

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; background:#05070b; color:#e5eefb; padding:32px;">
        <div style="max-width:720px; margin:0 auto; background:linear-gradient(135deg, rgba(17,24,39,0.95), rgba(10,15,24,0.95)); border:1px solid rgba(148,163,184,0.18); border-radius:28px; overflow:hidden;">
          <div style="padding:28px 32px; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:12px; letter-spacing:0.32em; text-transform:uppercase; color:#67e8f9;">AI Solar Report</div>
            <h1 style="margin:14px 0 0; font-size:28px; line-height:1.1;">Your report is ready, ${escapeHtml(body.name)}.</h1>
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
              <div style="margin-top:6px; font-size:14px; color:#cbd5e1;">Submitted by ${escapeHtml(body.email)}</div>
            </div>
            <div style="margin-top:16px; font-size:13px; line-height:1.6; color:#cbd5e1;">
              Download your secure PDF report here:
              <a href="${escapeHtml(reportUrl)}" style="color:#67e8f9; text-decoration:none;">View report</a>
            </div>
          </div>
        </div>
      </div>
    `;

    const subject = `Your AI solar report for ${body.address}`;
    const text = [
      `Hi ${body.name},`,
      "",
      `Your AI solar report is ready for ${body.address}.`,
      `Estimated annual savings: ${money(report.annualSavings)}`,
      `Estimated ROI: ${report.estimatedRoiYears} years`,
      `Environmental impact: ${report.annualImpactLbs.toLocaleString()} lbs CO2`,
      `Report link: ${reportUrl}`,
      "",
      "Thanks for requesting the report.",
    ].join("\n");

    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: body.email,
      subject,
      text,
      html,
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
