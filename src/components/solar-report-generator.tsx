"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { FollowUpTimeline } from "@/components/follow-up-timeline";
import { ButtonLink } from "@/components/ui/button";
import { createFollowUpSequence, type FollowUpStep } from "@/lib/follow-ups";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import { buildSolarMetrics } from "@/lib/solar-metrics";
import {
  buildSolarReportFromAnalysis,
  buildSolarReportFromSolarValues,
  type SolarReport,
} from "@/lib/solar-report";

type SolarReportGeneratorProps = {
  name: string;
  email: string;
  address: string;
  monthlyBill: number;
  leadId: string | null;
  reportUrl: string;
  analysis?: RoofAnalysis | null;
  onEmailStatusChange?: (status: "idle" | "sending" | "sent" | "error", message: string) => void;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value}%`;
}

export function SolarReportGenerator({
  name,
  email,
  address,
  monthlyBill,
  leadId,
  reportUrl,
  analysis,
  onEmailStatusChange,
}: SolarReportGeneratorProps) {
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailMessage, setEmailMessage] = useState("Preparing your report email...");
  const [followUpSteps, setFollowUpSteps] = useState<FollowUpStep[]>(
    () =>
      createFollowUpSequence({
        name,
        address,
        monthlyBill,
        annualSavings: analysis?.validSite
          ? buildSolarMetrics(analysis).annualSavings
          : undefined,
      })
  );
  const emailedLeadIdRef = useRef<string | null>(null);

  const report = useMemo<SolarReport>(
    () =>
      analysis
        ? buildSolarReportFromAnalysis(analysis, monthlyBill)
        : buildSolarReportFromSolarValues({
            annualSavings: 0,
            panelCount: 0,
            monthlyBill,
          }),
    [analysis, monthlyBill]
  );
  const statusLabel =
    emailState === "sent"
      ? "Delivered"
      : emailState === "error"
        ? "Needs attention"
        : emailState === "sending"
          ? "Sending"
          : "Local preview";
  const statusTone =
    emailState === "sent"
      ? "text-emerald-300"
      : emailState === "error"
        ? "text-rose-300"
        : "text-cyan-200";
  const statusCopy =
    emailState === "idle" && emailMessage === "Preparing your report email..."
      ? "Email is disabled in this local preview."
      : emailMessage;

  useEffect(() => {
    if (!leadId) return;
    if (emailedLeadIdRef.current === leadId) return;
    emailedLeadIdRef.current = leadId;
    const controller = new AbortController();
    let active = true;

    const sendReport = async () => {
      setEmailState("sending");
      setEmailMessage("Generating and emailing your solar report...");
      onEmailStatusChange?.("sending", "Generating and emailing your solar report...");

      const followUpsPromise = fetch("/api/follow-ups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload: { steps?: FollowUpStep[]; message?: string } = await response
            .json()
            .catch(() => ({}));

          if (!active || !response.ok || !payload.steps?.length) {
            return;
          }

          setFollowUpSteps(payload.steps);
        })
        .catch(() => {
          if (!active) return;
        });

      const response = await fetch("/api/report/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          leadId,
          name,
          email,
          address,
          monthlyBill,
          report,
        }),
      });

      const payload: { message?: string; skipped?: boolean } = await response
        .json()
        .catch(() => ({}));

      await followUpsPromise;

      if (!active) return;

      if (!response.ok) {
        const message = payload.message || "Unable to send the report email right now.";
        setEmailState("error");
        setEmailMessage(message);
        onEmailStatusChange?.("error", message);
        return;
      }

      const message =
        payload.message || "Your AI solar report has been emailed.";
      const nextState = payload.skipped ? "idle" : "sent";
      setEmailState(nextState);
      setEmailMessage(message);
      onEmailStatusChange?.(payload.skipped ? "idle" : "sent", message);
    };

    sendReport().catch(() => {
      if (!active) return;
      const message = "Unable to send the report email right now.";
      setEmailState("error");
      setEmailMessage(message);
      onEmailStatusChange?.("error", message);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [address, email, leadId, monthlyBill, name, onEmailStatusChange, report]);

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] p-6 shadow-[0_24px_80px_rgba(2,8,20,0.4)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.16),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(52,211,153,0.12),transparent_26%)]" />
      <div className="relative flex flex-col gap-6 xl:flex-row">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-emerald-300">
            AI solar report generator
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {name}, your report is ready to review.
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            We pulled the selected address, generated the solar estimate, and
            built the report preview for {email}.
          </p>

          <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-slate-950/45 px-4 py-4">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Email status
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${statusTone}`}
              >
                {statusLabel}
              </span>
              <p className="text-sm leading-6 text-slate-300">
                {statusCopy}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink
              href={reportUrl}
              variant="secondary"
              className="px-4 py-2 text-sm"
              target="_blank"
              rel="noreferrer"
            >
              Download PDF report
            </ButtonLink>
            <span
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300"
              title="This is a preview. Your dashboard will be available after report generation."
            >
              Dashboard preview only
            </span>
          </div>
        </div>

        <div className="grid gap-4 xl:flex-1 xl:grid-cols-2">
          {emailState === "sending" ? <ReportLoadingBackdrop /> : null}
          <PreviewCard
            title="House image"
            value="Arizona luxury home"
            description="The selected property anchors the report with the premium desert aesthetic."
            visual={
              <Image
                src="/modern-arizona-luxury-house.jpeg"
                alt="Arizona luxury home"
                width={960}
                height={540}
                className="h-44 w-full rounded-[1.35rem] object-cover"
              />
            }
          />

          <PreviewCard
            title="Installed solar preview"
            value={`${report.panelCount} panels`}
            description="The installed roof preview shows the system positioned on the garage roof plane."
            visual={
              <video
                autoPlay
                muted
                loop
                playsInline
                className="h-44 w-full rounded-[1.35rem] object-cover"
                poster="/modern-arizona-luxury-house.jpeg"
              >
                <source src="/solar-panels-installed-on-rooftop.mp4" type="video/mp4" />
              </video>
            }
          />

          <PreviewCard
            title="Estimated savings"
            value={formatMoney(report.annualSavings)}
            description="Estimated annual savings from the Solar API roof production model."
            metric={formatPercent(report.annualEnergyOffset)}
          />

          <PreviewCard
            title="Estimated ROI"
            value={`${report.estimatedRoiYears} years`}
            description="A clean estimate of the payback period for a typical Arizona solar install."
            metric="ROI"
          />

          <PreviewCard
            title="Environmental impact"
            value={`${report.annualImpactLbs.toLocaleString()} lbs`}
            description="Approximate yearly CO2 reduction impact from the modeled array."
            metric="CO2 offset"
          />

          {analysis ? (
            <PreviewCard
              title="Roof confidence"
              value={analysis.confidence}
              description={analysis.confidenceNote}
              metric={analysis.roofShape}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-6">
        <FollowUpTimeline
          steps={followUpSteps}
          title="Follow-up sequence"
          subtitle="The homeowner gets the report immediately, then a scheduled sequence keeps the conversation warm without losing the premium feel."
        />
      </div>
    </section>
  );
}

type PreviewCardProps = {
  title: string;
  value: string;
  description: string;
  metric?: string;
  visual?: ReactNode;
};

function PreviewCard({ title, value, description, metric, visual }: PreviewCardProps) {
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.28)]">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
        {title}
      </p>
      {visual ? <div className="mt-3">{visual}</div> : null}
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
        </div>
        {metric ? (
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-slate-300">
            {metric}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ReportLoadingBackdrop() {
  return (
    <div className="col-span-full rounded-[1.5rem] border border-cyan-300/12 bg-slate-950/40 p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full border border-cyan-300/20 bg-cyan-300/10" />
        <div className="min-w-0 flex-1">
          <div className="h-2.5 w-40 rounded-full bg-white/8 animate-pulse" />
          <div className="mt-2 h-2.5 w-64 rounded-full bg-white/8 animate-pulse [animation-delay:140ms]" />
        </div>
      </div>
    </div>
  );
}
