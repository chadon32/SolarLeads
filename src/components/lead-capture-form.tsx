"use client";

import type { ChangeEvent, FormEvent, InputHTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { FileCheck2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import { normalizeFourfoldAttributionKey } from "@/lib/attribution";
import {
  APP_LEAD_DISCLOSURE_COPY,
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
import {
  getReportEmailDeliveryCopy,
  normalizeReportEmailDeliveryStatus,
  type ReportEmailDeliveryStatus,
} from "@/lib/report-email-status";
import {
  UTILITY_BILL_FILE_TYPE_MESSAGE,
  UTILITY_BILL_MAX_FILE_SIZE_BYTES,
  UTILITY_BILL_MAX_FILE_SIZE_MESSAGE,
  UTILITY_BILL_UPLOAD_TIMEOUT_MS,
  getUtilityBillMimeType,
} from "@/lib/utility-bill-upload";
import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";
import type { RoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { buildSolarReportSnapshot } from "@/lib/report-snapshot";
import { buildActiveSolarEstimate, getActiveEstimateMetrics } from "@/lib/active-solar-estimate";
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
  emailDeliveryStatus?: ReportEmailDeliveryStatus;
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

function readSessionStorageItem(key: string) {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function readAttributionUtmId() {
  const queryValue = normalizeFourfoldAttributionKey(
    new URLSearchParams(window.location.search).get("utm_id")
  );
  return queryValue ?? normalizeFourfoldAttributionKey(
    readSessionStorageItem("solartelligenceUtmId")
  );
}

function persistSessionStorageItem(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocalStorageItem(key: string) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
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
  const router = useRouter();
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
  const [savedLead, setSavedLead] = useState<SavedLead | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
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
  const utilityBillUploadSequenceRef = useRef(0);
  const utilityBillAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    formStartedAt.current = Date.now();
    window.onSolartelligenceTurnstile = (token: string) => {
      setTurnstileToken(token);
    };

    return () => {
      utilityBillUploadSequenceRef.current += 1;
      utilityBillAbortControllerRef.current?.abort();
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
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const uploadSequence = utilityBillUploadSequenceRef.current + 1;
    utilityBillUploadSequenceRef.current = uploadSequence;
    utilityBillAbortControllerRef.current?.abort();
    utilityBillAbortControllerRef.current = null;

    // Clear the native value so selecting the same file retries the upload.
    input.value = "";

    const isCurrentUpload = () =>
      utilityBillUploadSequenceRef.current === uploadSequence;
    const mimeType = getUtilityBillMimeType(file.name, file.type);

    if (!mimeType) {
      setUtilityBill({
        error: UTILITY_BILL_FILE_TYPE_MESSAGE,
        fileName: file.name,
        status: "error",
      });
      return;
    }

    if (file.size > UTILITY_BILL_MAX_FILE_SIZE_BYTES) {
      setUtilityBill({
        error: UTILITY_BILL_MAX_FILE_SIZE_MESSAGE,
        fileName: file.name,
        status: "error",
      });
      return;
    }

    const abortController = new AbortController();
    utilityBillAbortControllerRef.current = abortController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, UTILITY_BILL_UPLOAD_TIMEOUT_MS);

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
        signal: abortController.signal,
      });

      if (!isCurrentUpload()) return;

      if (response.status === 413) {
        throw new Error(UTILITY_BILL_MAX_FILE_SIZE_MESSAGE);
      }

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        uploadClaim?: string;
        uploaded?: boolean;
      };

      if (!isCurrentUpload()) return;

      if (response.status === 503) {
        setUtilityBill({
          fileName: file.name,
          message:
            payload.message ||
            "Utility bill storage is not connected yet. You can still send the report without the upload.",
          status: "unavailable",
        });
        return;
      }

      if (!response.ok || !payload.uploaded || !payload.uploadClaim) {
        throw new Error(payload.message || "Utility bill upload failed.");
      }

      setUtilityBill({
        fileName: file.name,
        message: "Bill uploaded - estimate ready for review",
        status: "uploaded",
        uploadClaim: payload.uploadClaim,
      });
    } catch (error) {
      if (!isCurrentUpload()) return;

      setUtilityBill({
        error:
          timedOut
            ? "Utility bill upload timed out. Please try again."
            : error instanceof Error && error.name === "AbortError"
              ? "Utility bill upload was canceled. Please try again."
              : error instanceof Error
            ? error.message
            : "Unable to upload the utility bill. You can still send the report without it.",
        fileName: file.name,
        status: "error",
      });
    } finally {
      window.clearTimeout(timeoutId);
      if (utilityBillAbortControllerRef.current === abortController) {
        utilityBillAbortControllerRef.current = null;
      }
    }
  };

  const handleUtilityBillRemove = () => {
    utilityBillUploadSequenceRef.current += 1;
    utilityBillAbortControllerRef.current?.abort();
    utilityBillAbortControllerRef.current = null;
    setUtilityBill({ status: "idle" });
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
    const metrics = activeEstimate ? getActiveEstimateMetrics(activeEstimate) : null;
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
      setMessage(
        "Your utility bill is still uploading. Please wait a moment or remove it before submitting."
      );
      return;
    }

    const fingerprint = buildFingerprint(values);

    if (fingerprint === lastSubmittedFingerprint.current) {
      setStatus("error");
      setMessage("This report request was already submitted.");
      return;
    }

    setStatus("submitting");
    setMessage("Saving your report request...");

    const referredBy = readSessionStorageItem("referredBy");

    try {
      const utilityBillUploadClaim =
        utilityBill.status === "uploaded" ? utilityBill.uploadClaim : undefined;

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
          roofAnalysisProof: analysisProof ?? undefined,
          signedRoofAnalysis: signedRoofAnalysis ?? undefined,
          energyOffsetPct: metrics.coveragePct,
          solarSuitabilityScore: analysis.rooftopConfidenceScore,
          roofAreaSqm: getRoofAreaM2(analysis),
          usableAreaSqm: getUsableAreaM2(analysis),
          roofPitchDegrees: metrics.avgPitchDeg,
          reportSnapshot,
          lat,
          lng,
          pdfGenerated: false,
          utilityBillUploadClaim,
          utilityBillUploaded: Boolean(utilityBillUploadClaim),
          batteryAdded: addBattery,
          batteryBrand: selectedBattery?.brand,
          batteryModel: selectedBattery?.model,
          batteryCost: selectedBattery?.cost,
          referredBy,
          selectedPanelBrand: selectedPanel?.brand,
          selectedPanelModel: selectedPanel?.model,
          selectedPanelWatts: selectedPanel?.watts,
          systemCostBeforeIncentives: totalSystemCost,
          federalTaxCredit: totalFederalTaxCredit,
          netSystemCost: totalNetSystemCost,
          selectedInverterType,
          turnstileToken,
          utm_id: readAttributionUtmId() ?? undefined,
          website: honeypot,
        }),
      });

      const payload: { message?: string; lead?: SavedLead } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.lead) {
        setStatus("error");
        setMessage(payload.message || "Could not save your report request.");
        return;
      }

      lastSubmittedFingerprint.current = fingerprint;
      // Keep the server-confirmed lead in memory before optional browser APIs
      // run. A storage failure must not turn a successful save into a retry.
      setSavedLead(payload.lead);

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

      try {
        trackEvent("lead_submitted", {
          contact_requested: values.installerContactConsent,
          panel_count_bucket: getPanelCountBucket(metrics.panelCount),
        });
      } catch {
        // Analytics is optional and must not affect a confirmed submission.
      }

      const serializedThankYouPayload = JSON.stringify(thankYouPayload);
      const sessionStoragePersisted =
        persistSessionStorageItem("solartelligenceThankYou", serializedThankYouPayload) &&
        persistSessionStorageItem("solarLeadData", serializedThankYouPayload);
      const localStorageCleaned = removeLocalStorageItem("solarProgress");

      if (!sessionStoragePersisted || !localStorageCleaned) {
        setStorageWarning(true);
        return;
      }

      router.push("/thank-you");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  if (savedLead) {
    return (
      <SavedReportConfirmation
        lead={savedLead}
        storageWarning={storageWarning}
      />
    );
  }

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
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          noValidate
          className="rounded-card border border-ridge bg-night/50 p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div>
              <h3 className="text-2xl font-semibold text-ink">Send my full solar report</h3>
              <p className="mt-2 max-w-xl text-[0.9375rem] leading-7 text-ink-muted">
                We&rsquo;ll email you the full PDF report for this estimate.
              </p>
            </div>
            <p className="text-sm text-ink-dim">
              <span aria-hidden="true" className="text-sun">*</span> Required
            </p>
          </div>

          {activeErrors.length > 0 ? (
            <div
              ref={errorSummaryRef}
              id="lead-form-errors"
              tabIndex={-1}
              role="alert"
              className="mt-5 rounded-card border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-left outline-none focus:ring-2 focus:ring-rose-200"
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
                        className="underline underline-offset-2 hover:text-ink"
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
              required
              value={values.name}
              onChange={(value) => updateField("name", value)}
              error={errors.name}
              placeholder="Your full name"
              autoComplete="name"
            />
            <Field
              label="Email"
              required
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
              required
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
              required
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
              required
              value={values.ownsHome}
              onChange={(value) => updateField("ownsHome", value)}
              options={HOME_OWNERSHIP_OPTIONS}
              error={errors.ownsHome}
            />
            <SelectField
              label="Solar timeline"
              required
              value={values.solarTimeline}
              onChange={(value) => updateField("solarTimeline", value)}
              options={SOLAR_TIMELINE_OPTIONS}
              error={errors.solarTimeline}
            />
            {values.installerContactConsent ? (
              <SelectField
                label="Preferred contact method"
              required
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
              required
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
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-sky-100/85 transition hover:text-sky-100 [&::-webkit-details-marker]:hidden">
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
            onRemove={handleUtilityBillRemove}
          />

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-card border border-white/10 bg-slate-950/34 px-4 py-4 text-left">
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
              className="mt-0.5 h-5 w-5 shrink-0 accent-sky-200"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">
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

          <p className="mt-6 text-sm leading-6 text-ink-dim">
            Your roof settings stay on this device for up to 48 hours. {REPORT_DELIVERY_DISCLOSURE} Installer
            contact stays off unless you tick the box above. See our{" "}
            <Link className="text-sky-200 underline underline-offset-4 hover:text-ink" href="/privacy">
              privacy notice
            </Link>{" "}
            and{" "}
            <Link className="text-sky-200 underline underline-offset-4 hover:text-ink" href="/terms">
              estimate terms
            </Link>
            .
          </p>

          <div className="mt-5">
            <Button type="submit" disabled={status === "submitting"} className="min-h-12 w-full px-6 sm:w-auto">
              {status === "submitting" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-sun/20 border-t-on-sun" />
                  Sending your report…
                </span>
              ) : (
                "Send my full report"
              )}
            </Button>
          </div>

          <p
            aria-live="polite"
            className={`mt-3 text-sm font-medium ${status === "error" ? "text-rose-300" : "text-ink-muted"}`}
          >
            {status === "idle" ? "" : message}
          </p>
        </form>

        <aside aria-labelledby="report-next-steps-heading" className="h-fit rounded-card border border-ridge bg-night/50 p-5 sm:p-6">
          <h4 id="report-next-steps-heading" className="text-lg font-semibold text-ink">
            What happens next
          </h4>
          <ol className="mt-4 grid gap-4">
            {[
              ["We check your details", "So the report matches this address and bill."],
              ["Your report arrives by email", "A PDF with your roof layout, savings and assumptions."],
              ["An installer follows up, only if you asked", "Leave the box unticked and nobody calls."],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ridge text-sm font-semibold text-ink"
                >
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="mt-0.5 block text-sm leading-6 text-ink-muted">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

    </div>
  );
}

function SavedReportConfirmation({
  lead,
  storageWarning,
}: {
  lead: SavedLead;
  storageWarning: boolean;
}) {
  const confirmationHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const emailDeliveryStatus = normalizeReportEmailDeliveryStatus(
    lead.emailDeliveryStatus
  );
  const emailDeliveryCopy = getReportEmailDeliveryCopy(emailDeliveryStatus);

  useEffect(() => {
    confirmationHeadingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="report-save-confirmation"
      className="rounded-card border border-emerald-300/20 bg-emerald-300/[0.06] p-5 sm:p-6"
    >
      <p className="text-xs font-semibold text-emerald-200">
        Report saved
      </p>
      <h3
        id="report-save-confirmation"
        ref={confirmationHeadingRef}
        tabIndex={-1}
        className="mt-3 text-2xl font-semibold tracking-tight text-ink"
      >
        Your solar report is ready.
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-200">
        {emailDeliveryStatus === "sent"
          ? `We emailed your personalized report to ${lead.email}.`
          : emailDeliveryCopy.message}
      </p>
      {storageWarning ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 rounded-card border border-amber-200/20 bg-amber-200/10 px-4 py-3 text-sm leading-6 text-amber-50"
        >
          Browser storage was unavailable, but your report was saved. This
          confirmation is kept on this page and no second request is needed.
        </p>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          href={lead.reportUrl}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary min-h-12 px-5 py-3"
        >
          Open PDF report
        </a>
        <p className="text-sm text-slate-300">
          Saved for {formatDisplayAddress(lead.address)}.
        </p>
      </div>
    </section>
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
  required?: boolean;
};

const fieldInputBase =
  "min-h-12 w-full rounded-control border px-4 py-3 text-base text-ink outline-none transition-colors";
const fieldInputNormal =
  "border-ridge bg-raised placeholder:text-ink-dim focus:border-sky-300";
const fieldInputError =
  "border-rose-300/80 bg-rose-950/25 placeholder:text-rose-100/60 focus:border-rose-200";

function FieldLabel({
  error,
  htmlFor,
  label,
  required,
}: {
  error?: string;
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  // The star is a sibling of the <label>, so the field's name stays exactly the label text;
  // aria-required on the control tells assistive tech it is required.
  return (
    <span className="mb-2 flex items-baseline gap-1 text-sm font-semibold">
      <label htmlFor={htmlFor} className={error ? "text-rose-100" : "text-ink"}>
        {label}
      </label>
      {required ? (
        <span aria-hidden="true" className="text-sun">
          *
        </span>
      ) : null}
    </span>
  );
}

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
  required = false,
}: FieldProps) {
  const inputId = toFieldId(label);
  const descriptionId = `${inputId}-${error ? "error" : "help"}`;

  return (
    <div className="block">
      <FieldLabel error={error} htmlFor={inputId} label={label} required={required} />
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
          aria-required={required || undefined}
          aria-describedby={error || helperText ? descriptionId : undefined}
          className={`${fieldInputBase} ${prefix ? "pl-8" : ""} ${error ? fieldInputError : fieldInputNormal}`}
        />
      </div>
      {error ? (
        <p id={descriptionId} className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {!error && helperText ? (
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-dim">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

function SelectField({
  error,
  helperText,
  label,
  onChange,
  options,
  required = false,
  value,
}: {
  error?: string;
  helperText?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  required?: boolean;
  value: string;
}) {
  const inputId = toFieldId(label);
  const descriptionId = `${inputId}-${error ? "error" : "help"}`;

  return (
    <div className="block">
      <FieldLabel error={error} htmlFor={inputId} label={label} required={required} />
      <select
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-required={required || undefined}
        aria-describedby={error || helperText ? descriptionId : undefined}
        className={`${fieldInputBase} ${error ? fieldInputError : fieldInputNormal}`}
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
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-dim">
          {helperText}
        </p>
      ) : null}
    </div>
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
    <div className="block">
      <FieldLabel htmlFor={inputId} label={label} />
      <textarea
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${fieldInputBase} ${fieldInputNormal} min-h-28 resize-y leading-7`}
      />
    </div>
  );
}

function toFieldId(label: string) {
  return `lead-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function UtilityBillUploadCard({
  onChange,
  onRemove,
  state,
}: {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  state: UtilityBillState;
}) {
  const isUploaded = state.status === "uploaded";
  const isUploading = state.status === "uploading";
  const hasSelectedFile = Boolean(state.fileName);

  return (
    <section
      aria-busy={isUploading}
      className="mt-5 rounded-card border border-sky-300/14 bg-sky-300/[0.055] p-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-sky-200/18 bg-sky-300/10 text-sky-100">
            {isUploaded ? (
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <UploadCloud className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              Make this estimate more accurate
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Upload a recent utility bill so we can verify your usage and prepare a more accurate solar quote.
            </p>
            <p
              id="utility-bill-upload-help"
              className="mt-2 text-xs leading-5 text-slate-400"
            >
              Optional. PDF, JPG, or PNG up to 4MB. Used only for your solar estimate.
            </p>
          </div>
        </div>
        <label
          htmlFor="utility-bill-upload"
          className="btn btn-secondary min-h-11 shrink-0 cursor-pointer px-4 py-2.5 focus-within:ring-2 focus-within:ring-sky-200 focus-within:ring-offset-2 focus-within:ring-offset-slate-950"
        >
          {isUploading
            ? "Choose another bill"
            : isUploaded
              ? "Replace bill"
              : "Upload bill"}
          <input
            id="utility-bill-upload"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="sr-only"
            aria-describedby="utility-bill-upload-help"
            onChange={onChange}
          />
        </label>
      </div>
      {hasSelectedFile ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Selected file: {state.fileName}</p>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-slate-950/45 px-4 py-2 text-xs font-semibold text-sky-100 transition hover:border-sky-200/35 hover:bg-slate-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
          >
            {isUploading ? "Continue without bill" : "Remove bill"}
          </button>
        </div>
      ) : null}
      {state.message ? (
        <p
          className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isUploaded
              ? "bg-emerald-300/14 text-emerald-100"
              : "bg-amber-300/12 text-amber-100"
          }`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p
          className="mt-3 rounded-card border border-rose-300/18 bg-rose-300/10 px-3 py-2 text-sm text-rose-100"
          role="alert"
          aria-atomic="true"
        >
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
