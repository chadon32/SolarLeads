"use client";

import { useMemo, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import type { RoofShape, ShadingRisk } from "@/lib/roof-analysis";
import {
  buildRedactedScenarioText,
  getBroadRoofCategory,
  getBroadSunCategory,
  getSystemRange,
  ROOF_CATEGORY_OPTIONS,
  SCENARIO_LABEL_OPTIONS,
  SUN_CATEGORY_OPTIONS,
  SYSTEM_RANGE_OPTIONS,
  SCENARIO_SHARE_ASSUMPTION_DATE,
} from "@/lib/scenario-share";

type RedactedScenarioShareCardProps = {
  roofShape: RoofShape;
  shadingRisk: ShadingRisk;
  systemKw: number;
};

export function RedactedScenarioShareCard({
  roofShape,
  shadingRisk,
  systemKw,
}: RedactedScenarioShareCardProps) {
  const [label, setLabel] = useState<(typeof SCENARIO_LABEL_OPTIONS)[number]>(
    SCENARIO_LABEL_OPTIONS[0]
  );
  const [roof, setRoof] = useState<(typeof ROOF_CATEGORY_OPTIONS)[number]>(
    getBroadRoofCategory(roofShape)
  );
  const [sun, setSun] = useState<(typeof SUN_CATEGORY_OPTIONS)[number]>(
    getBroadSunCategory(shadingRisk)
  );
  const [system, setSystem] = useState<(typeof SYSTEM_RANGE_OPTIONS)[number]>(
    getSystemRange(systemKw)
  );
  const [status, setStatus] = useState<"idle" | "copied" | "unavailable">("idle");

  const shareText = useMemo(
    () => buildRedactedScenarioText({ label, roof, sun, system }),
    [label, roof, sun, system]
  );

  const copyShareText = async () => {
    if (!navigator.clipboard?.writeText) {
      setStatus("unavailable");
      return;
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setStatus("copied");
      trackEvent("scenario_share_copied", {
        output: "clipboard",
        surface: "overview",
      });
    } catch {
      setStatus("unavailable");
    }
  };

  const shareWithDevice = async () => {
    if (!navigator.share) {
      await copyShareText();
      return;
    }

    try {
      await navigator.share({
        title: "Solartelligence preliminary scenario",
        text: shareText,
      });
      setStatus("copied");
      trackEvent("scenario_share_copied", {
        output: "device_share",
        surface: "overview",
      });
    } catch {
      // A cancelled native share is not an error and should not show a warning.
    }
  };

  return (
    <section
      id="scenario-share"
      aria-labelledby="scenario-share-title"
      className="mt-1"
      data-testid="redacted-scenario-share-card"
    >
      {/* The disclosure around this card already shows the visible title. */}
      <h3 id="scenario-share-title" className="sr-only">
        Share a broad scenario, without your home details
      </h3>
      <p className="max-w-2xl text-sm leading-6 text-ink-muted">
        Pick broad labels, check the preview, then copy or share it. It never includes your address, bill,
        coordinates, contact details or report link.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SelectField label="Scenario label" value={label} onChange={setLabel} options={SCENARIO_LABEL_OPTIONS} />
        <SelectField label="Roof profile" value={roof} onChange={setRoof} options={ROOF_CATEGORY_OPTIONS} />
        <SelectField label="Sun exposure" value={sun} onChange={setSun} options={SUN_CATEGORY_OPTIONS} />
        <SelectField label="System size range" value={system} onChange={setSystem} options={SYSTEM_RANGE_OPTIONS} />
      </div>

      <div className="mt-4 rounded-card border border-ridge bg-night p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-sky-100/75">Preview</p>
          <p className="text-xs text-ink-muted">Reviewed {SCENARIO_SHARE_ASSUMPTION_DATE}</p>
        </div>
        <pre className="mt-3 whitespace-pre-wrap font-[inherit] text-sm leading-6 text-ink-muted">{shareText}</pre>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void copyShareText()}
          className="btn btn-secondary min-h-11 flex-1 px-5 py-3"
        >
          Copy redacted card
        </button>
        <button
          type="button"
          onClick={() => void shareWithDevice()}
          className="btn btn-secondary min-h-11 flex-1 px-5 py-3"
        >
          Share from this device
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-sky-100/72" aria-live="polite">
        {status === "copied"
          ? "Safe scenario text copied or shared."
          : status === "unavailable"
            ? "Sharing is unavailable in this browser. The preview remains available to copy manually."
            : "Only the fields shown in the preview can leave this report."}
      </p>
    </section>
  );
}

function SelectField<T extends readonly string[]>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T[number]) => void;
  options: T;
  value: T[number];
}) {
  return (
    <label className="block text-xs text-ink-muted">
      <span className="font-semibold">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T[number])}
        className="mt-2 min-h-11 w-full rounded-card border border-white/12 bg-black/35 px-3 py-2 text-sm font-semibold text-ink outline-none transition focus:border-sky-200/60"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-slate-950">
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
