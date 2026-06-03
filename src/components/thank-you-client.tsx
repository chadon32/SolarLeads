"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Mail,
  MapPin,
  SunMedium,
  type LucideIcon,
} from "lucide-react";
import { formatDisplayAddress } from "@/lib/address-format";
import {
  APP_LEAD_DISCLOSURE_COPY,
  APP_NAME,
  APP_PRIVACY_COPY,
} from "@/lib/brand";

type ThankYouPayload = {
  address?: string;
  annualSavings?: number;
  batteryAdded?: boolean;
  batteryBrand?: string;
  batteryCost?: number;
  batteryModel?: string;
  email?: string;
  firstName?: string;
  panelBrand?: string;
  panelCount?: number;
  panelModel?: string;
  paybackYears?: number;
  preferredContactMethod?: string;
  quoteRequested?: boolean;
  referralCode?: string | null;
  reportUrl?: string;
  systemKw?: number;
  utilityBillUploaded?: boolean;
};

const fallbackPayload: Required<Omit<ThankYouPayload, "reportUrl">> & {
  reportUrl?: string;
} = {
  address: "Your Arizona home",
  annualSavings: 0,
  batteryAdded: false,
  batteryBrand: "",
  batteryCost: 0,
  batteryModel: "",
  email: "",
  firstName: "there",
  panelBrand: "",
  panelCount: 0,
  panelModel: "",
  paybackYears: 0,
  preferredContactMethod: "Phone",
  quoteRequested: false,
  referralCode: null,
  systemKw: 0,
  utilityBillUploaded: false,
};

export function ThankYouClient() {
  const [payload, setPayload] = useState<ThankYouPayload | null>(null);

  useEffect(() => {
    let frame = 0;

    try {
      const stored =
        window.sessionStorage.getItem("solarLeadData") ||
        window.sessionStorage.getItem("arizonaSolarThankYou");
      const parsed = stored ? (JSON.parse(stored) as ThankYouPayload) : {};
      frame = window.requestAnimationFrame(() => setPayload(parsed));
    } catch {
      frame = window.requestAnimationFrame(() => setPayload({}));
    }

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const summary = useMemo(() => {
    const source = { ...fallbackPayload, ...(payload ?? {}) };

    return {
      ...source,
      address: formatDisplayAddress(source.address),
      annualSavings: safeNumber(source.annualSavings),
      firstName: source.firstName?.trim() || "there",
      panelCount: Math.max(0, Math.round(safeNumber(source.panelCount))),
      panelBrand: source.panelBrand || "",
      panelModel: source.panelModel || "",
      paybackYears: safeNumber(source.paybackYears),
      preferredContactMethod: source.preferredContactMethod || "Phone",
      quoteRequested: Boolean(source.quoteRequested),
      referralCode: source.referralCode || null,
      systemKw: safeNumber(source.systemKw),
      utilityBillUploaded: Boolean(source.utilityBillUploaded),
    };
  }, [payload]);
  const referralUrl =
    summary.referralCode && typeof window !== "undefined"
      ? `${window.location.origin}?ref=${encodeURIComponent(summary.referralCode)}`
      : "";
  const whatsappUrl = referralUrl
    ? `https://wa.me/?text=${encodeURIComponent(
        `I just got my free solar estimate - my roof could save $${summary.annualSavings}/yr. Get yours: ${referralUrl}`
      )}`
    : "";
  const smsUrl = referralUrl
    ? `sms:?body=${encodeURIComponent(
        `Free Arizona solar estimate tool: ${referralUrl}`
      )}`
    : "";

  const loaded = payload !== null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.18),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(251,191,36,0.12),transparent_28%),linear-gradient(180deg,#030712_0%,#07111d_52%,#02040a_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(8,13,22,0.92))]" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-4xl rounded-[2rem] border border-white/12 bg-white/[0.055] p-5 shadow-[0_32px_100px_rgba(0,0,0,0.42)] backdrop-blur-2xl sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100">
                <CheckCircle2 className="h-4 w-4" />
                {summary.quoteRequested ? "Request received" : "Report ready"}
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {summary.quoteRequested
                  ? `Your quote request was received, ${loaded ? summary.firstName : "there"}.`
                  : `Your solar report is ready, ${loaded ? summary.firstName : "there"}.`}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                {summary.quoteRequested
                  ? "Your request was received. A solar specialist can follow up with your report details."
                  : `We emailed your personalized ${APP_NAME} proposal and saved the roof model summary for your next step.`}
              </p>
              <p className="mt-4 rounded-[1rem] border border-white/8 bg-slate-950/28 px-4 py-3 text-sm leading-6 text-slate-300">
                {APP_PRIVACY_COPY}
              </p>
              <p className="mt-2 text-xs leading-6 text-slate-500">
                {APP_LEAD_DISCLOSURE_COPY}
              </p>
              {summary.utilityBillUploaded ? (
                <p className="mt-4 inline-flex rounded-full border border-emerald-300/18 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100">
                  Your utility bill was received. We will use it to prepare a more accurate quote.
                </p>
              ) : null}
            </div>
            <Link
              href="/"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition hover:border-cyan-200/35 hover:bg-cyan-200/12"
            >
              Back to my estimate
            </Link>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/42 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
                Report summary
              </p>
              <div className="mt-4 flex items-start gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.04] p-4">
                <MapPin className="mt-1 h-5 w-5 shrink-0 text-cyan-200" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Address
                  </p>
                  <p className="mt-1 text-base font-medium text-white">
                    {summary.address}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SummaryMetric
                  label="System size"
                  value={summary.systemKw > 0 ? `${summary.systemKw.toFixed(1)} kW` : "Pending"}
                />
                <SummaryMetric
                  label="Annual savings"
                  value={summary.annualSavings > 0 ? formatMoney(summary.annualSavings) : "Pending"}
                />
                <SummaryMetric
                  label="Panel count"
                  value={summary.panelCount > 0 ? `${summary.panelCount}` : "Pending"}
                />
                <SummaryMetric
                  label="Payback"
                  value={summary.paybackYears > 0 ? `${summary.paybackYears.toFixed(1)} yrs` : "Pending"}
                />
                <SummaryMetric
                  label="Quote request"
                  value={summary.quoteRequested ? "Received" : "Pending"}
                />
                <SummaryMetric
                  label="Preferred contact"
                  value={summary.preferredContactMethod}
                />
              </div>

              {summary.reportUrl ? (
                <a
                  href={summary.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
                >
                  <FileText className="h-4 w-4" />
                  Open PDF report
                </a>
              ) : null}
            </article>

            <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/42 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
                What happens next
              </p>
              <div className="mt-5 grid gap-3">
                <NextStep
                  index="1"
                  icon={Mail}
                  title="Your report has been emailed to you"
                  body="Your PDF proposal is sent to the email you entered."
                />
                <NextStep
                  index="2"
                  icon={SunMedium}
                  title="Get matched with local quote options"
                  body="A solar specialist can follow up with your report details and final review preferences."
                />
                <NextStep
                  index="3"
                  icon={CheckCircle2}
                  title="Free on-site quote scheduled"
                  body="Final layout, pricing, incentives, and installation details are confirmed in person."
                />
              </div>
            </article>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.85fr]">
            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/42 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
                What happens next?
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                A solar advisor follows up within 24 hours
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                A solar advisor will reach out to review your report and answer
                any questions. No pressure - you&apos;re in control of the timeline.
              </p>
              <div className="mt-4 grid gap-2 text-sm font-semibold text-emerald-50">
                <span className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-4 py-2">
                  Report emailed to you
                </span>
                <span className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-4 py-2">
                  Advisor follows up by phone
                </span>
                <span className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-4 py-2">
                  Free on-site quote when ready
                </span>
              </div>
            </section>

            {summary.referralCode ? (
              <section className="rounded-[1.5rem] border border-emerald-300/14 bg-emerald-300/[0.055] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100">
                  Share Your Report
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  Know someone curious about solar?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Share your report link so friends, family, or neighbors can
                  check their home&apos;s solar potential too.
                </p>
                <div className="mt-4 rounded-[1rem] border border-white/10 bg-slate-950/45 p-3">
                  <p className="break-all text-sm font-semibold text-white">
                    {referralUrl}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(referralUrl);
                    }}
                    className="mt-3 w-full rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
                  >
                    Copy link
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                  >
                    Share on WhatsApp
                  </a>
                  <a
                    href={smsUrl}
                    className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                  >
                    Share via text
                  </a>
                </div>
              </section>
            ) : null}
            <section className="rounded-[1.5rem] border border-amber-300/14 bg-amber-300/[0.055] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-100">
                Share your savings
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Your roof could save {formatMoney(summary.annualSavings)}/year
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Share this with friends who pay high Arizona electric bills.
              </p>
              {referralUrl ? (
                <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                    >
                      Share on WhatsApp
                    </a>
                    <a
                      href={smsUrl}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                    >
                      Share via text
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(referralUrl);
                      }}
                      className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
                    >
                      Copy link
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    Share this link with anyone interested in seeing their home&apos;s
                    solar potential.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Your share link will appear here when the report data is loaded.
                </p>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.05rem] border border-white/8 bg-white/[0.04] p-4">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function NextStep({
  body,
  icon: Icon,
  index,
  title,
}: {
  body: string;
  icon: LucideIcon;
  index: string;
  title: string;
}) {
  return (
    <div className="flex gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.04] p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-cyan-300/18 bg-cyan-300/10 text-cyan-100">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-white">
          {index}. {title}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
      </div>
    </div>
  );
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}
