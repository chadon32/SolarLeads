"use client";

import type { ChangeEvent, FormEvent, InputHTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileCheck2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import type { BatteryOption } from "@/lib/batteries";
import { formatName } from "@/lib/name-format";
import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";
import { buildSolarMetrics } from "@/lib/solar-metrics";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import {
  getInverterOption,
  getPanelFit,
  type InverterType,
  type SolarPanel,
} from "@/lib/solarPanels";

type LeadCaptureFormProps = {
  initialAddress: string;
  analysis?: RoofAnalysis | null;
  activePanelCount?: number;
  initialMonthlyBill?: number;
  lat?: number;
  lng?: number;
  onMonthlyBillChange?: (monthlyBill: number) => void;
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
  monthlyBill: string;
  preferredContactMethod: string;
  bestTimeToContact: string;
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
  utilityBillUploaded?: boolean;
};

type UtilityBillState = {
  error?: string;
  fileName?: string;
  message?: string;
  status: "idle" | "uploading" | "uploaded" | "error" | "unavailable";
  uploadClaim?: string;
};

const emptyValues: FormValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  monthlyBill: "",
  preferredContactMethod: "Phone",
  bestTimeToContact: "Afternoon",
  notes: "",
};

const contactMethodOptions = ["Phone", "Text", "Email"] as const;
const bestTimeOptions = ["Morning", "Afternoon", "Evening", "Weekend"] as const;
const utilityBillMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
const utilityBillMaxBytes = 10 * 1024 * 1024;

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhoneDisplay(value: string) {
  const digits = normalizePhone(value).slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)})-${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string) {
  const digits = normalizePhone(value);
  return digits.length >= 10 && digits.length <= 15;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildFingerprint(values: FormValues) {
  return [
    values.name.trim().toLowerCase(),
    values.email.trim().toLowerCase(),
    normalizePhone(values.phone),
    values.address.trim().toLowerCase(),
    values.monthlyBill.trim(),
    values.preferredContactMethod.trim().toLowerCase(),
    values.bestTimeToContact.trim().toLowerCase(),
    values.notes.trim().toLowerCase(),
  ].join("|");
}

export function LeadCaptureForm({
  initialAddress,
  analysis,
  activePanelCount,
  initialMonthlyBill = 200,
  lat,
  lng,
  onMonthlyBillChange,
  selectedInverterType = "string",
  selectedPanel,
  addBattery = false,
  selectedBattery,
}: LeadCaptureFormProps) {
  const [values, setValues] = useState<FormValues>({
    ...emptyValues,
    address: formatDisplayAddress(initialAddress),
    monthlyBill: String(initialMonthlyBill),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>(
    {}
  );
  const [status, setStatus] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Your AI solar report is being generated"
  );
  const [utilityBill, setUtilityBill] = useState<UtilityBillState>({
    status: "idle",
  });
  const [smsConsent, setSmsConsent] = useState(true);
  const lastSubmittedFingerprint = useRef<string>("");

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      setValues((current) =>
        current.address === formatDisplayAddress(initialAddress) &&
        current.monthlyBill === String(initialMonthlyBill)
          ? current
          : {
              ...current,
              address: formatDisplayAddress(initialAddress),
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
      const baseMetrics = buildSolarMetrics(analysis, {
        monthlyBill: Number.isFinite(monthlyBill) ? monthlyBill : undefined,
        selectedPanelCount: activePanelCount,
      });
      const inverter = getInverterOption(selectedInverterType);

      if (selectedPanel) {
        return getPanelFit(selectedPanel, {
          roofData: analysis,
          monthlyBill: Number.isFinite(monthlyBill) ? monthlyBill : undefined,
          selectedPanelCount: activePanelCount ?? baseMetrics.panelCount,
          inverterCostAdderPerWatt: inverter.costAdderPerWatt,
        }).annualSavings;
      }

      return baseMetrics.annualSavings;
    }

    return 0;
  }, [activePanelCount, analysis, selectedInverterType, selectedPanel, values.monthlyBill]);

  const validate = () => {
    const nextErrors: Partial<Record<keyof FormValues, string>> = {};

    if (values.name.trim().length < 2) {
      nextErrors.name = "Please enter your full name.";
    }

    if (!isValidEmail(values.email)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!isValidPhone(values.phone)) {
      nextErrors.phone = "Enter a valid phone number with at least 10 digits.";
    }

    if (values.address.trim().length < 8) {
      nextErrors.address = "Please enter a full service address.";
    }

    const monthly = Number(values.monthlyBill);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      nextErrors.monthlyBill = "Enter your estimated monthly electric bill.";
    }

    if (!values.preferredContactMethod.trim()) {
      nextErrors.preferredContactMethod = "Choose how you prefer to be contacted.";
    }

    if (!values.bestTimeToContact.trim()) {
      nextErrors.bestTimeToContact = "Choose the best time to contact you.";
    }

    setErrors(nextErrors);
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
    const formattedName = formatName(values.name);
    const baseMetrics = analysis?.validSite
      ? buildSolarMetrics(analysis, {
          monthlyBill,
          selectedPanelCount: activePanelCount,
        })
      : null;
    const selectedInverter = getInverterOption(selectedInverterType);
    const panelFit =
      analysis?.validSite && selectedPanel && baseMetrics
        ? getPanelFit(selectedPanel, {
            roofData: analysis,
            monthlyBill,
            selectedPanelCount: activePanelCount ?? baseMetrics.panelCount,
            inverterCostAdderPerWatt: selectedInverter.costAdderPerWatt,
          })
        : null;
    const batteryCost = addBattery && selectedBattery ? selectedBattery.cost : 0;
    const totalSystemCost = (panelFit?.systemCost ?? 0) + batteryCost;
    const totalFederalTaxCredit = Math.round(totalSystemCost * 0.3);
    const totalNetSystemCost = Math.max(totalSystemCost - totalFederalTaxCredit, 0);
    const totalPaybackYears =
      panelFit && panelFit.annualSavings > 0
        ? Number((totalNetSystemCost / panelFit.annualSavings).toFixed(1))
        : panelFit?.paybackYears ?? baseMetrics?.paybackYears ?? 0;
    const metrics =
      baseMetrics && panelFit
        ? {
            ...baseMetrics,
            annualKwh: panelFit.annualKwh,
            annualSavings: panelFit.annualSavings,
            monthlySavings: Math.round(panelFit.annualSavings / 12),
            panelCount: panelFit.maxPanelsFit,
            paybackYears: totalPaybackYears,
            systemKw: panelFit.systemKw,
          }
        : baseMetrics;

    if (!analysis?.validSite || !metrics || !metrics.annualSavings) {
      setStatus("error");
      setMessage("Complete a valid Solar API roof analysis before generating the report.");
      return;
    }

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
          phone: values.phone.trim(),
          address: values.address.trim(),
          monthlyBill,
          preferredContactMethod: values.preferredContactMethod,
          bestTimeToContact: values.bestTimeToContact,
          notes: values.notes.trim(),
          quoteRequested: true,
          panelCount: metrics.panelCount,
          systemSizeKw: metrics.systemKw,
          annualSavings: metrics.annualSavings,
          monthlySavings: metrics.monthlySavings,
          annualEnergyKwh: metrics.annualKwh,
          twentyYearSavings: metrics.annualSavings * 20,
          energyOffsetPct: metrics.coveragePct,
          solarSuitabilityScore: analysis.rooftopConfidenceScore,
          roofAreaSqm: getRoofAreaM2(analysis),
          usableAreaSqm: getUsableAreaM2(analysis),
          roofPitchDegrees: metrics.avgPitchDeg,
          lat,
          lng,
          pdfGenerated: true,
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
          smsConsent,
          systemCostBeforeIncentives: totalSystemCost || panelFit?.systemCost,
          federalTaxCredit: totalFederalTaxCredit || panelFit?.taxCredit,
          netSystemCost: totalNetSystemCost || panelFit?.netCost,
          selectedInverterType,
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
        annual_savings: metrics.annualSavings,
        lead_id: payload.lead.id,
        panel_count: metrics.panelCount,
      });
      const report = buildSolarReportFromSolarValues({
        annualKwh: metrics.annualKwh,
        annualSavings: metrics.annualSavings,
        monthlyBill,
        panelCount: metrics.panelCount,
        systemKw: metrics.systemKw,
      });

      setMessage("Emailing your PDF report...");
      console.info("[lead-sms-request]", {
        consent: smsConsent,
        leadId: payload.lead.id,
      });

      await Promise.allSettled([
        fetch("/api/follow-ups", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leadId: payload.lead.id }),
        }),
        fetch("/api/report/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            leadId: payload.lead.id,
            name: payload.lead.name,
            email: payload.lead.email,
            address: payload.lead.address,
            monthlyBill,
            report,
            utilityBillUploaded: Boolean(payload.lead.utilityBillUploaded),
          }),
        }),
        fetch("/api/sms", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            leadId: payload.lead.id,
            phone: values.phone.trim(),
            phoneConsent: smsConsent,
          }),
        }),
      ]);

      const thankYouPayload = {
          address: formatDisplayAddress(payload.lead.address),
          annualSavings: metrics.annualSavings,
          batteryAdded: addBattery,
          batteryBrand: selectedBattery?.brand,
          batteryCost: selectedBattery?.cost,
          batteryModel: selectedBattery?.model,
          email: values.email.trim(),
          firstName: formattedName.split(/\s+/)[0] ?? "there",
          panelCount: metrics.panelCount,
          panelBrand: selectedPanel?.brand,
          panelModel: selectedPanel?.model,
          paybackYears: metrics.paybackYears,
          preferredContactMethod: values.preferredContactMethod,
          quoteRequested: true,
          referralCode: payload.lead.referralCode,
          reportUrl: payload.lead.reportUrl,
          systemKw: metrics.systemKw,
          utilityBillUploaded: Boolean(payload.lead.utilityBillUploaded),
      };

      sessionStorage.setItem("arizonaSolarThankYou", JSON.stringify(thankYouPayload));
      sessionStorage.setItem("solarLeadData", JSON.stringify(thankYouPayload));
      localStorage.removeItem("solarProgress");
      window.location.assign("/thank-you");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
        <form
          onSubmit={handleSubmit}
          className="glass-panel h-full rounded-[2rem] p-6 shadow-[0_24px_80px_rgba(2,8,20,0.4)]"
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
              Secure capture
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
              label="Phone"
              value={values.phone}
              onChange={(value) => updateField("phone", formatPhoneDisplay(value))}
              error={errors.phone}
              placeholder="Your phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <Field
              label="Monthly bill"
              value={values.monthlyBill}
              onChange={(value) => {
                updateField("monthlyBill", value);
                const nextMonthlyBill = Number(value);
                if (Number.isFinite(nextMonthlyBill) && nextMonthlyBill > 0) {
                  onMonthlyBillChange?.(nextMonthlyBill);
                }
              }}
              error={errors.monthlyBill}
              placeholder="$ 200"
              type="number"
              inputMode="decimal"
              prefix="$"
              autoComplete="off"
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

          <label className="mt-4 flex items-start gap-3 rounded-[1rem] border border-white/8 bg-slate-950/30 px-4 py-3 text-sm leading-6 text-slate-300">
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(event) => setSmsConsent(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 accent-cyan-300"
            />
            <span>
              By providing your phone number, you agree to receive your solar
              report and follow-up by text. Reply STOP to opt out.
            </span>
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Preferred contact method"
              value={values.preferredContactMethod}
              onChange={(value) => updateField("preferredContactMethod", value)}
              options={contactMethodOptions}
              error={errors.preferredContactMethod}
            />
            <SelectField
              label="Best time to contact"
              value={values.bestTimeToContact}
              onChange={(value) => updateField("bestTimeToContact", value)}
              options={bestTimeOptions}
              error={errors.bestTimeToContact}
            />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Notes"
                value={values.notes}
                onChange={(value) => updateField("notes", value)}
                placeholder="Anything a solar specialist should know? Roof concerns, battery interest, timeline, or utility questions..."
              />
            </div>
          </div>

          <UtilityBillUploadCard
            state={utilityBill}
            onChange={handleUtilityBillChange}
          />

          <p className="mt-6 text-center text-sm leading-6 text-slate-400">
            No spam. Your report details are used to help licensed Arizona solar specialists prepare relevant quotes.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">
              Estimated annual savings:{" "}
              <span className="font-semibold text-white">
                {estimatedSavings > 0 ? formatMoney(estimatedSavings) : "Run roof analysis first"}
              </span>
            </div>
            <Button type="submit" disabled={status === "submitting"} className="px-6 py-3.5">
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
            className="mt-5 min-h-[3.5rem] rounded-[1.25rem] border border-white/8 bg-slate-950/35 px-4 py-3"
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
                    ? "Sending full report"
                    : "Your AI solar report is being generated"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {status === "submitting"
                    ? "Saving your preferences, preparing the PDF email, and marking the report for follow-up."
                    : "Submit when you are ready to receive the full homeowner PDF report."}
              </p>
              {status === "submitting" ? <StatusSkeleton /> : null}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
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
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
        {label}
      </span>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            {prefix}
          </span>
        ) : null}
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          className={`w-full rounded-[1.2rem] border bg-slate-950/40 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-slate-950/65 ${
            prefix ? "pl-8" : ""
          } ${error ? "border-rose-400/50" : "border-white/10"}`}
        />
      </div>
      {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
      {!error && helperText ? (
        <p className="mt-2 text-sm leading-6 text-slate-400">{helperText}</p>
      ) : null}
    </label>
  );
}

function SelectField({
  error,
  label,
  onChange,
  options,
  value,
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-[1.2rem] border bg-slate-950/40 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-300/35 focus:bg-slate-950/65 ${
          error ? "border-rose-400/50" : "border-white/10"
        }`}
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-slate-950">
            {option}
          </option>
        ))}
      </select>
      {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
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
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-28 w-full resize-y rounded-[1.2rem] border border-white/10 bg-slate-950/40 px-4 py-3 text-base leading-7 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-slate-950/65"
      />
    </label>
  );
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
