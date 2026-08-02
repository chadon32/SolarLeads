"use client";

import type { ChangeEvent, FormEvent, InputHTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { FileCheck2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import {
  APP_LEAD_DISCLOSURE_COPY,
  APP_PRIVACY_COPY,
  REPORT_DELIVERY_DISCLOSURE,
} from "@/lib/brand";
import type { BatteryOption } from "@/lib/batteries";
import {
  BEST_TIME_OPTIONS,
  CONTACT_METHOD_OPTIONS,
  ELECTRIC_BILL_RANGE_OPTIONS,
  HOME_OWNERSHIP_OPTIONS,
  SOLAR_TIMELINE_OPTIONS,
  getBillRangeByMonthlyBill,
  getMonthlyBillFromRange,
} from "@/lib/lead-form-values";
import {
  addressesMatch,
  isReasonableMonthlyBill,
} from "@/lib/lead-validation";
import { formatName } from "@/lib/name-format";
import {
  formatPhoneForDisplay,
  isValidUsPhoneNumber,
  normalizePhoneNumber,
} from "@/lib/phone";
import { formatCurrency } from "@/lib/number-format";
import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";
import type { RoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { buildSolarReportSnapshot } from "@/lib/report-snapshot";
import { buildActiveSolarEstimate } from "@/lib/active-solar-estimate";
import {
  getInverterOption,
  getPanelById,
  type InverterType,
  type SolarPanel,
} from "@/lib/solarPanels";

type LeadCaptureFormProps = {
  initialAddress: string;
  analysis?: RoofAnalysis | null;
  analysisProof?: RoofAnalysisProof | null;
  signedRoofAnalysis?: RoofAnalysis | null;
  activePanelCount?: number;
  initialMonthlyBill?: number;
  lat?: number;
  lng?: number;
  selectedInverterType?: InverterType;
  selectedPanel?: SolarPanel | null;
  addBattery?: boolean;
  selectedBattery?: BatteryOption | null;
};

type FormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
  electricBillRange: string;
  monthlyBill: string;
  ownsHome: string;
  solarTimeline: string;
  preferredContactMethod: string;
  bestTimeToContact: string;
  installerContactConsent: boolean;
  notes: string;
};

type SavedLead = {
  id: string;
  name: string;
  email: string;
  address: string;
  monthlyBill: number;
  estimatedSavings: number;
  quoteRequested?: boolean;
  reportUrl: string;
  referralCode?: string | null;
  reportSummary?: {
    annualSavings: number | null;
    energyOffsetPct: number | null;
    monthlySavings: number | null;
    panelCount: number | null;
    paybackYears: number | null;
    systemSizeKw: number | null;
  };
  utilityBillUploaded?: boolean;
  emailDeliveryStatus?: "sent" | "delayed";
};

type UtilityBillState = {
  error?: string;
  fileName?: string;
  message?: string;
  status: "idle" | "uploading" | "uploaded" | "error" | "unavailable";
  uploadClaim?: string;
};

declare global {
  interface Window {
    onSolartelligenceTurnstile?: (token: string) => void;
  }
}

const emptyValues: FormValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  electricBillRange: "",
  monthlyBill: "",
  ownsHome: "",
  solarTimeline: "",
  preferredContactMethod: "",
  bestTimeToContact: "",
  installerContactConsent: false,
  notes: "",
};

const utilityBillMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
const utilityBillMaxBytes = 10 * 1024 * 1024;
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const leadFieldIds: Partial<Record<keyof FormValues, string>> = {
  name: "lead-name",
  email: "lead-email",
  phone: "lead-phone-optional",
  electricBillRange: "lead-average-monthly-electric-bill",
  monthlyBill: "lead-average-monthly-electric-bill",
  address: "lead-address",
  ownsHome: "lead-owns-home-or-rents",
  solarTimeline: "lead-solar-timeline",
  preferredContactMethod: "lead-preferred-contact-method",
  bestTimeToContact: "lead-best-time-to-contact",
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildLeadNotes(values: FormValues) {
  const context = [
    `Home ownership: ${values.ownsHome}`,
    `Solar timeline: ${values.solarTimeline}`,
  ];
  const notes = values.notes.trim();

  return notes ? [...context, `Homeowner notes: ${notes}`].join("\n") : context.join("\n");
}

function buildFingerprint(values: FormValues) {
  return [
    values.name.trim().toLowerCase(),
    values.email.trim().toLowerCase(),
    normalizePhoneNumber(values.phone),
    values.address.trim().toLowerCase(),
    values.electricBillRange.trim().toLowerCase(),
    values.monthlyBill.trim(),
    values.ownsHome.trim().toLowerCase(),
    values.solarTimeline.trim().toLowerCase(),
    values.preferredContactMethod.trim().toLowerCase(),
    values.bestTimeToContact.trim().toLowerCase(),
    String(values.installerContactConsent),
    values.notes.trim().toLowerCase(),
  ].join("|");
}

export function LeadCaptureForm({
  initialAddress,
  analysis,
  analysisProof,
  signedRoofAnalysis,
  activePanelCount,
  initialMonthlyBill = 200,
  lat,
  lng,
  selectedInverterType = "string",
  selectedPanel,
  addBattery = false,
  selectedBattery,
}: LeadCaptureFormProps) {
  const [values, setValues] = useState<FormValues>({
    ...emptyValues,
    address: formatDisplayAddress(initialAddress),
    electricBillRange: getBillRangeByMonthlyBill(initialMonthlyBill),
    monthlyBill: String(initialMonthlyBill),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>(
    {}
  );
  const [status, setStatus] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Complete the form to receive your full report."
  );
  const [utilityBill, setUtilityBill] = useState<UtilityBillState>({
    status: "idle",
  });
  const [honeypot, setHoneypot] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const formStartedAt = useRef(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const lastSubmittedFingerprint = useRef<string>("");

  useEffect(() => {
    formStartedAt.current = Date.now();
    window.onSolartelligenceTurnstile = (token: string) => {
      setTurnstileToken(token);
    };

    return () => {
      delete window.onSolartelligenceTurnstile;
    };
  }, []);

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      setValues((current) =>
        current.address === formatDisplayAddress(initialAddress) &&
        current.monthlyBill === String(initialMonthlyBill) &&
        current.electricBillRange === getBillRangeByMonthlyBill(initialMonthlyBill)
          ? current
          : {
              ...current,
              address: formatDisplayAddress(initialAddress),
              electricBillRange: getBillRangeByMonthlyBill(initialMonthlyBill),
              monthlyBill: String(initialMonthlyBill),
            }
      );
      setErrors((current) => ({ ...current, address: undefined }));
    });

    return () => window.cancelAnimationFrame(handle);
  }, [initialAddress, initialMonthlyBill]);

  const estimatedSavings = useMemo(() => {
    if (analysis?.validSite) {
      const monthlyBill = Number(values.monthlyBill);
      return buildActiveSolarEstimate({
        analysis,
        batteryCost: addBattery && selectedBattery ? selectedBattery.cost : 0,
        inverterCostAdderPerWatt: getInverterOption(selectedInverterType)
          .costAdderPerWatt,
        monthlyBill: Number.isFinite(monthlyBill) ? monthlyBill : undefined,
        selectedPanel: selectedPanel ?? getPanelById(),
        selectedPanelCount: activePanelCount,
      }).annualSavings;
    }

    return 0;
  }, [
    activePanelCount,
    addBattery,
    analysis,
    selectedBattery,
    selectedInverterType,
    selectedPanel,
    values.monthlyBill,
  ]);

  const validate = () => {
    const nextErrors: Partial<Record<keyof FormValues, string>> = {};

    if (values.name.trim().length < 2) {
      nextErrors.name = "Please enter your full name.";
    }

    if (!isValidEmail(values.email)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (values.phone.trim() && !isValidUsPhoneNumber(values.phone)) {
      nextErrors.phone =
        "Enter a valid 10-digit US phone number or leave it blank.";
    }

    if (values.address.trim().length < 8) {
      nextErrors.address = "Please enter a full service address.";
    }

    const monthly = Number(values.monthlyBill);
    if (!isReasonableMonthlyBill(monthly)) {
      nextErrors.monthlyBill = "Enter your estimated monthly electric bill.";
    }

    if (!values.electricBillRange.trim()) {
      nextErrors.electricBillRange = "Choose your average monthly electric bill.";
    }

    if (
      analysis?.validSite &&
      initialAddress.trim() &&
      values.address.trim() &&
      !addressesMatch(initialAddress, values.address)
    ) {
      nextErrors.address =
        "This address no longer matches the completed roof analysis. Re-run the estimate for the updated address.";
    }

    if (!values.ownsHome.trim()) {
      nextErrors.ownsHome = "Choose whether you own or rent.";
    }

    if (!values.solarTimeline.trim()) {
      nextErrors.solarTimeline = "Choose your solar timeline.";
    }

    if (
      values.installerContactConsent &&
      !values.preferredContactMethod.trim()
    ) {
      nextErrors.preferredContactMethod = "Choose how you prefer to be contacted.";
    }

    if (
      values.installerContactConsent &&
      values.preferredContactMethod === "Phone" &&
      !isValidUsPhoneNumber(values.phone)
    ) {
      nextErrors.phone =
        "Enter a valid 10-digit US phone number for phone follow-up.";
    }

    if (
      values.installerContactConsent &&
      values.preferredContactMethod === "Phone" &&
      !values.bestTimeToContact.trim()
    ) {
      nextErrors.bestTimeToContact = "Choose the best time to contact you.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      window.requestAnimationFrame(() => {
        errorSummaryRef.current?.focus();
      });
    }
    return Object.keys(nextErrors).length === 0;
  };

  const updateField = <K extends keyof FormValues>(
    field: K,
    value: FormValues[K]
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleUtilityBillChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      setUtilityBill({ status: "idle" });
      return;
    }

    if (!utilityBillMimeTypes.includes(file.type)) {
      setUtilityBill({
        error: "Upload a PDF, JPG, or PNG utility bill.",
        fileName: file.name,
        status: "error",
      });
      event.target.value = "";
      return;
    }

    if (file.size > utilityBillMaxBytes) {
      setUtilityBill({
        error: "Utility bill uploads must be 10MB or smaller.",
        fileName: file.name,
        status: "error",
      });
      event.target.value = "";
      return;
    }

    setUtilityBill({
      fileName: file.name,
      message: "Uploading securely...",
      status: "uploading",
    });

    try {
      const formData = new FormData();
      formData.append("bill", file);
      formData.append("address", values.address);
      formData.append("email", values.email);
      formData.append("phone", values.phone);

      const response = await fetch("/api/utility-bills", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        uploadClaim?: string;
        uploaded?: boolean;
      };

      if (response.status === 503 || !payload.uploaded) {
        setUtilityBill({
          fileName: file.name,
          message:
            payload.message ||
            "Utility bill storage is not connected yet. You can still send the report without the upload.",
          status: "unavailable",
        });
        return;
      }

      if (!response.ok || !payload.uploadClaim) {
        throw new Error(payload.message || "Utility bill upload failed.");
      }

      setUtilityBill({
        fileName: file.name,
        message: "Bill uploaded - estimate ready for review",
        status: "uploaded",
        uploadClaim: payload.uploadClaim,
      });
    } catch (error) {
      setUtilityBill({
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload the utility bill. You can still send the report without it.",
        fileName: file.name,
        status: "error",
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (status === "submitting") return;
    if (!validate()) return;

    const monthlyBill = Number(values.monthlyBill);
    const phoneForStorage = normalizePhoneNumber(values.phone);
    const formattedName = formatName(values.name);
    const activeEstimate = analysis?.validSite
      ? buildActiveSolarEstimate({
          analysis,
          batteryCost: addBattery && selectedBattery ? selectedBattery.cost : 0,
          inverterCostAdderPerWatt: getInverterOption(selectedInverterType)
            .costAdderPerWatt,
          monthlyBill,
          selectedPanel: selectedPanel ?? getPanelById(),
          selectedPanelCount: activePanelCount,
        })
      : null;
    const metrics = activeEstimate
      ? {
          ...activeEstimate.baseMetrics,
          annualKwh: activeEstimate.annualKwh,
          annualSavings: activeEstimate.annualSavings,
          coveragePct: activeEstimate.energyOffsetPct,
          monthlySavings: activeEstimate.monthlySavings,
          panelCount: activeEstimate.panelCount,
          paybackYears: activeEstimate.paybackYears,
          systemKw: activeEstimate.systemKw,
        }
      : null;
    const totalSystemCost = activeEstimate?.installedCost ?? 0;
    const totalFederalTaxCredit = activeEstimate?.taxCredit ?? 0;
    const totalNetSystemCost = activeEstimate?.netCostAfterCredit ?? 0;

    if (!analysis?.validSite || !metrics || !metrics.annualSavings) {
      setStatus("error");
      setMessage("Complete a valid Solar API roof analysis before generating the report.");
      return;
    }

    const reportSnapshot = buildSolarReportSnapshot({
      activePanelCount,
      address: values.address.trim(),
      analysis,
      lat,
      lng,
      metrics,
      monthlyBill,
    });

    if (utilityBill.status === "uploading") {
      setStatus("error");
      setMessage("Your utility bill is still uploading. Please wait a moment or submit without it.");
      return;
    }

    const fingerprint = buildFingerprint(values);

    if (fingerprint === lastSubmittedFingerprint.current) {
      setStatus("error");
      setMessage("That lead was already submitted.");
      return;
    }

    setStatus("submitting");
    setMessage("Saving your lead...");

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formattedName,
          email: values.email.trim(),
          phone: phoneForStorage,
          companyWebsite: honeypot,
          formStartedAt: formStartedAt.current,
          address: values.address.trim(),
          electricBillRange: values.electricBillRange,
          monthlyBill,
          ownsHome: values.ownsHome,
          preferredContactMethod: values.preferredContactMethod,
          solarTimeline: values.solarTimeline,
          bestTimeToContact: values.bestTimeToContact,
          notes: buildLeadNotes(values),
          installerContactConsent: values.installerContactConsent,
          quoteRequested: values.installerContactConsent,
          panelCount: metrics.panelCount,
          systemSizeKw: metrics.systemKw,
          annualSavings: metrics.annualSavings,
          monthlySavings: metrics.monthlySavings,
          annualEnergyKwh: metrics.annualKwh,
          roofAnalysisProof: analysisProof,
          signedRoofAnalysis,
          energyOffsetPct: metrics.coveragePct,
          solarSuitabilityScore: analysis.rooftopConfidenceScore,
          roofAreaSqm: getRoofAreaM2(analysis),
          usableAreaSqm: getUsableAreaM2(analysis),
          roofPitchDegrees: metrics.avgPitchDeg,
          reportSnapshot,
          lat,
          lng,
          pdfGenerated: false,
          utilityBillUploadClaim:
            utilityBill.status === "uploaded" ? utilityBill.uploadClaim : undefined,
          utilityBillUploaded: utilityBill.status === "uploaded",
          batteryAdded: addBattery,
          batteryBrand: selectedBattery?.brand,
          batteryModel: selectedBattery?.model,
          batteryCost: selectedBattery?.cost,
          referredBy:
            typeof window !== "undefined"
              ? window.sessionStorage.getItem("referredBy")
              : undefined,
          selectedPanelBrand: selectedPanel?.brand,
          selectedPanelModel: selectedPanel?.model,
          selectedPanelWatts: selectedPanel?.watts,
          systemCostBeforeIncentives: totalSystemCost,
          federalTaxCredit: totalFederalTaxCredit,
          netSystemCost: totalNetSystemCost,
          selectedInverterType,
          turnstileToken,
          website: honeypot,
        }),
      });

      const payload: { message?: string; lead?: SavedLead } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.lead) {
        setStatus("error");
        setMessage(payload.message || "Could not save the lead.");
        return;
      }

      lastSubmittedFingerprint.current = fingerprint;
      trackEvent("lead_submitted", {
        contact_requested: values.installerContactConsent,
        panel_count_bucket: getPanelCountBucket(metrics.panelCount),
      });
      setMessage("Preparing your confirmation...");

      const thankYouPayload = {
          address: formatDisplayAddress(payload.lead.address),
          annualSavings:
            payload.lead.reportSummary?.annualSavings ?? metrics.annualSavings,
          batteryAdded: addBattery,
          batteryBrand: selectedBattery?.brand,
          batteryCost: selectedBattery?.cost,
          batteryModel: selectedBattery?.model,
          email: values.email.trim(),
          firstName: formattedName.split(/\s+/)[0] ?? "there",
          panelCount:
            payload.lead.reportSummary?.panelCount ?? metrics.panelCount,
          panelBrand: selectedPanel?.brand,
          panelModel: selectedPanel?.model,
          paybackYears:
            payload.lead.reportSummary?.paybackYears ?? metrics.paybackYears,
          preferredContactMethod: values.preferredContactMethod,
          emailDeliveryStatus: payload.lead.emailDeliveryStatus,
          quoteRequested: values.installerContactConsent,
          referralCode: payload.lead.referralCode,
          reportUrl: payload.lead.reportUrl,
          systemKw:
            payload.lead.reportSummary?.systemSizeKw ?? metrics.systemKw,
          utilityBillUploaded: Boolean(payload.lead.utilityBillUploaded),
      };

      sessionStorage.setItem(
        "solartelligenceThankYou",
        JSON.stringify(thankYouPayload)
      );
      sessionStorage.setItem("solarLeadData", JSON.stringify(thankYouPayload));
      localStorage.removeItem("solarProgress");
      window.location.assign("/thank-you");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const activeErrors = (
    Object.entries(errors) as [keyof FormValues, string | undefined][]
  ).filter(([, error]) => Boolean(error));

  return (
    <div className="grid gap-5">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          noValidate
          className="glass-panel h-full rounded-[1.6rem] p-4 shadow-[0_24px_80px_rgba(2,8,20,0.4)] sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Full report
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Send my full solar report.
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
                Enter your details and we will email the full PDF report for this
                preliminary roof model.
              </p>
            </div>
            <div className="hidden rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200 sm:inline-flex">
              Protected submission
            </div>
          </div>

          {activeErrors.length > 0 ? (
            <div
              ref={errorSummaryRef}
              id="lead-form-errors"
              tabIndex={-1}
              role="alert"
              className="mt-5 rounded-[1.05rem] border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-left outline-none focus:ring-2 focus:ring-rose-200"
            >
              <p className="font-semibold text-rose-100">
                Please review {activeErrors.length} highlighted field
                {activeErrors.length === 1 ? "" : "s"}.
              </p>
              <ul className="mt-2 grid gap-1 text-sm text-rose-200">
                {activeErrors.map(([field, error]) =>
                  error ? (
                    <li key={field}>
                      <a
                        className="underline underline-offset-2 hover:text-white"
                        href={`#${leadFieldIds[field]}`}
                        onClick={(event) => {
                          const target = document.getElementById(leadFieldIds[field] ?? "");
                          if (!target) return;
                          event.preventDefault();
                          target.focus();
                        }}
                      >
                        {error}
                      </a>
                    </li>
                  ) : null
                )}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div aria-hidden="true" className="hidden">
              <label>
                Website
                <input
                  autoComplete="off"
                  tabIndex={-1}
                  type="text"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </label>
            </div>
            <Field
              label="Name"
              value={values.name}
              onChange={(value) => updateField("name", value)}
              error={errors.name}
              placeholder="Your full name"
              autoComplete="name"
            />
            <Field
              label="Email"
              value={values.email}
              onChange={(value) => updateField("email", value)}
              error={errors.email}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
            />
            <Field
              label="Phone (optional)"
              value={values.phone}
              onChange={(value) => updateField("phone", formatPhoneForDisplay(value))}
              error={errors.phone}
              placeholder="Your phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <SelectField
              label="Average monthly electric bill"
              value={values.electricBillRange}
              onChange={(value) => {
                updateField("electricBillRange", value);
                const nextMonthlyBill = getMonthlyBillFromRange(value);
                updateField("monthlyBill", String(nextMonthlyBill));
              }}
              options={ELECTRIC_BILL_RANGE_OPTIONS}
              error={errors.electricBillRange || errors.monthlyBill}
              helperText="Used to estimate the savings shown in your report."
            />
            <div className="sm:col-span-2">
              <Field
                label="Address"
                value={values.address}
                onChange={(value) => updateField("address", value)}
                error={errors.address}
                placeholder="Service address"
                autoComplete="street-address"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Owns home or rents"
              value={values.ownsHome}
              onChange={(value) => updateField("ownsHome", value)}
              options={HOME_OWNERSHIP_OPTIONS}
              error={errors.ownsHome}
            />
            <SelectField
              label="Solar timeline"
              value={values.solarTimeline}
              onChange={(value) => updateField("solarTimeline", value)}
              options={SOLAR_TIMELINE_OPTIONS}
              error={errors.solarTimeline}
            />
            {values.installerContactConsent ? (
              <SelectField
                label="Preferred contact method"
                value={values.preferredContactMethod}
                onChange={(value) =>
                  updateField("preferredContactMethod", value)
                }
                options={CONTACT_METHOD_OPTIONS}
                error={errors.preferredContactMethod}
              />
            ) : null}
            {values.installerContactConsent &&
            values.preferredContactMethod === "Phone" ? (
              <SelectField
                label="Best time to contact"
                value={values.bestTimeToContact}
                onChange={(value) => updateField("bestTimeToContact", value)}
                options={BEST_TIME_OPTIONS}
                error={errors.bestTimeToContact}
              />
            ) : null}
            {/* Collapsed by default. It is the only free-text field here and
                it is entirely optional, so an always-open textarea just adds
                visible weight to the form for the majority who skip it. The
                value is still submitted normally once opened. */}
            <details className="group sm:col-span-2">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-cyan-100/85 transition hover:text-cyan-100 [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden="true"
                  className="text-base leading-none transition-transform group-open:rotate-45"
                >
                  +
                </span>
                Add a note for the installer (optional)
              </summary>
              <div className="mt-3">
                <TextAreaField
                  label="Notes"
                  value={values.notes}
                  onChange={(value) => updateField("notes", value)}
                  placeholder="Anything a solar specialist should know? Roof concerns, battery interest, timeline, or utility questions..."
                />
              </div>
            </details>
          </div>

          <UtilityBillUploadCard
            state={utilityBill}
            onChange={handleUtilityBillChange}
          />

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[1.15rem] border border-white/10 bg-slate-950/34 px-4 py-4 text-left">
            <input
              type="checkbox"
              checked={values.installerContactConsent}
              onChange={(event) => {
                const checked = event.target.checked;
                updateField("installerContactConsent", checked);

                if (!checked) {
                  updateField("preferredContactMethod", "");
                  updateField("bestTimeToContact", "");
                }
              }}
              className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-200"
            />
            <span>
              <span className="block text-sm font-semibold text-white">
                Optional installer follow-up
              </span>
              <span className="mt-1 block text-sm leading-6 text-slate-400">
                {APP_LEAD_DISCLOSURE_COPY}
              </span>
            </span>
          </label>

          {turnstileSiteKey ? (
            <div className="mt-4 flex justify-center">
              <div
                className="cf-turnstile"
                data-callback="onSolartelligenceTurnstile"
                data-sitekey={turnstileSiteKey}
                data-theme="dark"
              />
            </div>
          ) : null}

          <p className="mt-6 text-center text-sm leading-6 text-slate-400">
            {APP_PRIVACY_COPY}
          </p>
          <p className="mt-2 text-center text-[0.8rem] leading-6 text-slate-500">
            {REPORT_DELIVERY_DISCLOSURE}
          </p>
          <p className="mt-2 text-center text-xs leading-5 text-slate-400">
            Review our{" "}
            <Link className="underline underline-offset-2" href="/privacy">
              privacy notice
            </Link>{" "}
            and{" "}
            <Link className="underline underline-offset-2" href="/terms">
              estimate terms
            </Link>
            .
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="rounded-[1rem] border border-white/8 bg-slate-950/28 px-4 py-3 text-sm text-slate-300">
              Estimated annual savings:{" "}
              <span className="font-semibold text-white">
                {estimatedSavings > 0 ? formatCurrency(estimatedSavings) : "Run roof analysis first"}
              </span>
            </div>
            <Button type="submit" disabled={status === "submitting"} className="min-h-12 w-full px-6 py-3.5 sm:w-auto">
              {status === "submitting" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/20 border-t-slate-950" />
                  Sending full report...
                </span>
              ) : (
                "Send My Full Report"
              )}
            </Button>
          </div>

          <div
            className="mt-5 min-h-[3.25rem] rounded-[1.05rem] border border-white/8 bg-slate-950/35 px-4 py-3"
            aria-live="polite"
          >
            <p
              className={`text-sm font-medium ${
                status === "error"
                    ? "text-rose-300"
                    : "text-slate-300"
              }`}
            >
              {message}
            </p>
          </div>
        </form>

        <div className="relative h-full overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 shadow-[0_24px_80px_rgba(2,8,20,0.35)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.16),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_24%)]" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              What happens next
            </p>
            <h4 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              What happens next
            </h4>
            <div className="mt-6 grid gap-3">
              {[
                "Validate report details",
                "Email your full solar report",
                "Prepare your report for installer review",
              ].map((item, index) => (
                <div
                  key={item}
                  className={`flex items-center gap-3 rounded-[1.1rem] border px-4 py-3 text-sm ${
                    index === 0
                      ? "border-white/8 bg-white/5 text-slate-100"
                      : "border-white/6 bg-slate-950/20 text-slate-300"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.85)]" />
                  {item}
                </div>
              ))}
            </div>

            <div
              className={`mt-6 rounded-[1.5rem] border px-5 py-5 shadow-[0_18px_50px_rgba(2,8,20,0.25)] transition-all duration-500 ${
                status === "submitting"
                    ? "border-cyan-300/16 bg-slate-950/42"
                    : "border-cyan-300/10 bg-slate-950/35"
              }`}
            >
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Report status
              </p>
              <p className="mt-3 text-lg font-semibold tracking-tight text-white">
                {status === "submitting"
                  ? "Sending your full report"
                  : "Ready to generate your report"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {status === "submitting"
                  ? "Saving your preferences and preparing the PDF report."
                  : "Complete the form once, then receive your homeowner PDF report by email."}
              </p>
              {status === "submitting" ? <StatusSkeleton /> : null}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function getPanelCountBucket(panelCount: number) {
  if (panelCount < 10) return "under_10";
  if (panelCount < 20) return "10_19";
  if (panelCount < 30) return "20_29";
  return "30_plus";
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  type?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  prefix?: string;
  autoComplete?: string;
  helperText?: string;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  type = "text",
  inputMode,
  prefix,
  autoComplete,
  helperText,
}: FieldProps) {
  const inputId = toFieldId(label);
  const descriptionId = `${inputId}-${error ? "error" : "help"}`;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
        {label}
      </span>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            {prefix}
          </span>
        ) : null}
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error || helperText ? descriptionId : undefined}
          className={`min-h-12 w-full rounded-[1.05rem] border bg-slate-950/46 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-slate-950/68 ${
            prefix ? "pl-8" : ""
          } ${error ? "border-rose-400/50" : "border-white/10"}`}
        />
      </div>
      {error ? (
        <p id={descriptionId} className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {!error && helperText ? (
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-400">
          {helperText}
        </p>
      ) : null}
    </label>
  );
}

function SelectField({
  error,
  helperText,
  label,
  onChange,
  options,
  value,
}: {
  error?: string;
  helperText?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  const inputId = toFieldId(label);
  const descriptionId = `${inputId}-${error ? "error" : "help"}`;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
        {label}
      </span>
      <select
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helperText ? descriptionId : undefined}
        className={`min-h-12 w-full rounded-[1.05rem] border bg-slate-950/46 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-300/45 focus:bg-slate-950/68 ${
          error ? "border-rose-400/50" : "border-white/10"
        }`}
      >
        <option value="" disabled className="bg-slate-950">
          Select an option
        </option>
        {options.map((option) => (
          <option key={option} value={option} className="bg-slate-950">
            {option}
          </option>
        ))}
      </select>
      {error ? (
        <p id={descriptionId} className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {!error && helperText ? (
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-400">
          {helperText}
        </p>
      ) : null}
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const inputId = toFieldId(label);

  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
        {label}
      </span>
      <textarea
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-28 w-full resize-y rounded-[1.05rem] border border-white/10 bg-slate-950/46 px-4 py-3 text-base leading-7 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-slate-950/68"
      />
    </label>
  );
}

function toFieldId(label: string) {
  return `lead-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function UtilityBillUploadCard({
  onChange,
  state,
}: {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  state: UtilityBillState;
}) {
  const isUploaded = state.status === "uploaded";
  const isUploading = state.status === "uploading";

  return (
    <section className="mt-5 rounded-[1.35rem] border border-cyan-300/14 bg-cyan-300/[0.055] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-cyan-200/18 bg-cyan-300/10 text-cyan-100">
            {isUploaded ? (
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <UploadCloud className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              Make this estimate more accurate
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Upload a recent utility bill so we can verify your usage and prepare a more accurate solar quote.
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Optional. PDF, JPG, or PNG. Used only for your solar estimate.
            </p>
          </div>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100">
          {isUploading ? "Uploading..." : isUploaded ? "Replace bill" : "Upload bill"}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="sr-only"
            disabled={isUploading}
            onChange={onChange}
          />
        </label>
      </div>
      {state.fileName ? (
        <p className="mt-3 text-xs text-slate-400">Selected file: {state.fileName}</p>
      ) : null}
      {state.message ? (
        <p
          className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isUploaded
              ? "bg-emerald-300/14 text-emerald-100"
              : "bg-amber-300/12 text-amber-100"
          }`}
        >
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p className="mt-3 rounded-[0.9rem] border border-rose-300/18 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

function StatusSkeleton() {
  return (
    <div className="mt-4 grid gap-2">
      <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-white/8" />
      <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-white/8 [animation-delay:140ms]" />
      <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-white/8 [animation-delay:280ms]" />
    </div>
  );
}
