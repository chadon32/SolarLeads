"use client";

import type { FormEvent, InputHTMLAttributes } from "react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";

const SolarReportGenerator = dynamic(
  () =>
    import("@/components/solar-report-generator").then(
      (module) => module.SolarReportGenerator
    ),
  {
    ssr: false,
  }
);

type LeadCaptureFormProps = {
  initialAddress: string;
  analysis?: RoofAnalysis | null;
  lat?: number;
  lng?: number;
};

type FormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
  monthlyBill: string;
};

type SavedLead = {
  id: string;
  name: string;
  email: string;
  address: string;
  monthlyBill: number;
  estimatedSavings: number;
  reportUrl: string;
};

const emptyValues: FormValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  monthlyBill: "",
};

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
  ].join("|");
}

export function LeadCaptureForm({
  initialAddress,
  analysis,
  lat,
  lng,
}: LeadCaptureFormProps) {
  const [values, setValues] = useState<FormValues>({
    ...emptyValues,
    address: initialAddress,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>(
    {}
  );
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Your AI solar report is being generated"
  );
  const [successSavings, setSuccessSavings] = useState<number | null>(null);
  const [savedLead, setSavedLead] = useState<SavedLead | null>(null);
  const lastSubmittedFingerprint = useRef<string>("");

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      setValues((current) =>
        current.address === initialAddress
          ? current
          : { ...current, address: initialAddress }
      );
      setErrors((current) => ({ ...current, address: undefined }));
    });

    return () => window.cancelAnimationFrame(handle);
  }, [initialAddress]);

  const estimatedSavings = useMemo(() => {
    if (analysis?.annualSavingsUSD) {
      return analysis.annualSavingsUSD;
    }

    return 0;
  }, [analysis?.annualSavingsUSD]);

  const handleEmailStatusChange = useCallback(
    (nextStatus: "idle" | "sending" | "sent" | "error", nextMessage: string) => {
      setMessage(nextMessage);
      if (nextStatus === "error") {
        setStatus("error");
      }
    },
    []
  );

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (status === "submitting") return;
    if (!validate()) return;

    if (!analysis?.validSite || !analysis.annualSavingsUSD) {
      setStatus("error");
      setMessage("Complete a valid Solar API roof analysis before generating the report.");
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

    const monthlyBill = Number(values.monthlyBill);
    const savings = analysis.annualSavingsUSD;

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          address: values.address.trim(),
          monthlyBill,
          panelCount: analysis.panelCount,
          systemSizeKw: analysis.systemKw,
          annualSavings: analysis.annualSavingsUSD,
          monthlySavings: Math.round(analysis.annualSavingsUSD / 12),
          annualEnergyKwh: analysis.annualKwh,
          roofAreaSqm: getRoofAreaM2(analysis),
          usableAreaSqm: getUsableAreaM2(analysis),
          roofPitchDegrees: analysis.pitchDeg,
          lat,
          lng,
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
      setSavedLead(payload.lead);
      setStatus("success");
      setMessage("Your AI solar report is being generated");
      setSuccessSavings(payload.lead.estimatedSavings ?? savings);
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
                Lead capture
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Get your AI solar report.
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
                Enter your details and we will send the report as soon as it is generated.
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
              placeholder="(602) 555-0123"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <Field
              label="Monthly bill"
              value={values.monthlyBill}
              onChange={(value) => updateField("monthlyBill", value)}
              error={errors.monthlyBill}
              placeholder="e.g. 180"
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

          <p className="mt-6 text-center text-sm leading-6 text-slate-400">
            No spam. No sales calls without your permission. Your info is only shared with licensed AZ installers.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">
              Estimated annual savings:{" "}
              <span className="font-semibold text-white">
                {estimatedSavings > 0 ? formatMoney(estimatedSavings) : "Run roof analysis first"}
              </span>
            </div>
            {status === "success" ? (
              <div className="inline-flex items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/12 px-6 py-3.5 text-sm font-semibold text-emerald-200">
                Report sent! Check your email within 2 minutes.
              </div>
            ) : (
              <Button type="submit" disabled={status === "submitting"} className="px-6 py-3.5">
                {status === "submitting" ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-slate-950/20 border-t-slate-950 animate-spin" />
                    Generating your report...
                  </span>
                ) : (
                  "Generate Report"
                )}
              </Button>
            )}
          </div>

          <div
            className="mt-5 min-h-[3.5rem] rounded-[1.25rem] border border-white/8 bg-slate-950/35 px-4 py-3"
            aria-live="polite"
          >
            <p
              className={`text-sm font-medium ${
                status === "success"
                  ? "text-emerald-300"
                  : status === "error"
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
                "Validate contact details",
                "Store lead in Supabase",
                "Generate the solar report",
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
                status === "success"
                  ? "border-emerald-300/20 bg-emerald-300/10"
                  : status === "submitting"
                    ? "border-cyan-300/16 bg-slate-950/42"
                    : "border-cyan-300/10 bg-slate-950/35"
              }`}
            >
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Report status
              </p>
              <p className="mt-3 text-lg font-semibold tracking-tight text-white">
                Your AI solar report is being generated
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {status === "success"
                  ? `Lead saved. Estimated savings: ${formatMoney(
                      successSavings ?? 0
                    )}`
                  : status === "submitting"
                    ? "Saving the homeowner details and preparing the report."
                    : "Once the lead is submitted, the report status will switch here automatically."}
              </p>
              {status === "submitting" ? <StatusSkeleton /> : null}
              {status === "success" ? (
                <div className="mt-4 flex items-center gap-3">
                  <span className="success-pop flex h-10 w-10 items-center justify-center rounded-full bg-emerald-300/15 text-emerald-200">OK</span>
                  <span className="text-sm font-medium text-emerald-200">
                    Report ready
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {savedLead ? (
        <SolarReportGenerator
          key={savedLead.id}
          leadId={savedLead.id}
          reportUrl={savedLead.reportUrl}
          name={savedLead.name}
          email={savedLead.email}
          address={savedLead.address}
          monthlyBill={savedLead.monthlyBill}
          analysis={analysis}
          onEmailStatusChange={handleEmailStatusChange}
        />
      ) : null}
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

function StatusSkeleton() {
  return (
    <div className="mt-4 grid gap-2">
      <div className="h-2.5 w-3/4 rounded-full bg-white/8 animate-pulse" />
      <div className="h-2.5 w-1/2 rounded-full bg-white/8 animate-pulse [animation-delay:140ms]" />
      <div className="h-2.5 w-2/3 rounded-full bg-white/8 animate-pulse [animation-delay:280ms]" />
    </div>
  );
}


