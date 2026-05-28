"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { RoofModel3D } from "@/components/roof-model-3d";
import {
  buildFallbackRoofAnalysis,
  getMonthlySavings,
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";

type ResolvedProperty = {
  address: string;
  lat: number;
  lng: number;
};

type SolarAnalysisProps = {
  address: string;
  location?: {
    lat?: number;
    lng?: number;
  } | null;
  onAnalysisChange?: (analysis: RoofAnalysis | null) => void;
};

type SatellitePreviewPayload = {
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  message?: string;
};

type SatelliteImagePayload = {
  base64?: string;
  mimeType?: string;
  message?: string;
};

type AnalyzeRoofPayload = {
  analysis?: RoofAnalysis;
  fallback?: RoofAnalysis;
  message?: string;
  detail?: string;
};

export function SolarAnalysis({
  address,
  location,
  onAnalysisChange,
}: SolarAnalysisProps) {
  const [stage, setStage] = useState<
    "idle" | "resolving" | "fetching" | "analyzing" | "done" | "error"
  >("idle");
  const [satelliteImage, setSatelliteImage] = useState<string | null>(null);
  const [roofData, setRoofData] = useState<RoofAnalysis | null>(null);
  const [resolvedProperty, setResolvedProperty] = useState<ResolvedProperty | null>(
    null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const trimmedAddress = address.trim();

    if (!trimmedAddress) {
      const resetHandle = window.requestAnimationFrame(() => {
        setStage("idle");
        setSatelliteImage(null);
        setRoofData(null);
        setResolvedProperty(null);
        setNotice(null);
        setErrorMessage("");
        onAnalysisChange?.(null);
      });

      return () => window.cancelAnimationFrame(resetHandle);
    }

    const controller = new AbortController();
    let cancelled = false;

    const runAnalysis = async () => {
      try {
        setStage("resolving");
        setNotice(null);
        setErrorMessage("");
        setRoofData(null);
        onAnalysisChange?.(null);

        const property = await resolveProperty(
          trimmedAddress,
          location,
          controller.signal
        );

        if (cancelled) {
          return;
        }

        setResolvedProperty(property);
        setStage("fetching");

        const imageResponse = await fetch(
          `/api/satellite-image?lat=${encodeURIComponent(
            property.lat
          )}&lng=${encodeURIComponent(property.lng)}`,
          {
            signal: controller.signal,
          }
        );
        const imagePayload: SatelliteImagePayload = await imageResponse
          .json()
          .catch(() => ({}));

        if (!imageResponse.ok || !imagePayload.base64 || !imagePayload.mimeType) {
          throw new Error(
            imagePayload.message || "Could not load the rooftop satellite image."
          );
        }

        const dataUri = `data:${imagePayload.mimeType};base64,${imagePayload.base64}`;
        setSatelliteImage(dataUri);
        setStage("analyzing");

        const analysisResponse = await fetch("/api/analyze-roof", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            base64: imagePayload.base64,
            mimeType: imagePayload.mimeType,
            address: property.address,
            lat: property.lat,
            lng: property.lng,
          }),
        });

        const analysisPayload: AnalyzeRoofPayload = await analysisResponse
          .json()
          .catch(() => ({}));

        const fallback = buildFallbackRoofAnalysis({
          address: property.address,
          lat: property.lat,
          lng: property.lng,
        });
        const nextRoofData =
          analysisPayload.analysis ?? analysisPayload.fallback ?? fallback;

        setRoofData(nextRoofData);
        onAnalysisChange?.(nextRoofData);
        setStage("done");
        setNotice(
          analysisResponse.ok
            ? nextRoofData.confidence !== "high"
              ? nextRoofData.confidenceNote
              : null
            : analysisPayload.message ??
                "Detailed roof analysis was unavailable, so this view is using a modeled Arizona estimate."
        );
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }

        setStage("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not complete the roof analysis."
        );
      }
    };

    void runAnalysis();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, location, onAnalysisChange]);

  const cards = useMemo(() => {
    if (!roofData) {
      return [];
    }

    return [
      { label: "System size", value: `${roofData.systemKw.toFixed(1)} kW` },
      { label: "Panel count", value: `${roofData.panelCount}` },
      {
        label: "Annual savings",
        value: `$${roofData.annualSavingsUSD.toLocaleString()}`,
      },
      { label: "Roof pitch", value: `${roofData.pitchDeg.toFixed(1)} deg` },
      { label: "Usable area", value: `${getUsableAreaM2(roofData).toFixed(1)} sq m` },
      { label: "Shading risk", value: roofData.shadingRisk },
      { label: "Roof shape", value: roofData.roofShape },
      {
        label: "Annual energy",
        value: `${roofData.annualKwh.toLocaleString()} kWh`,
      },
    ];
  }, [roofData]);

  const stageStep =
    stage === "resolving"
      ? { label: "Resolving property location...", pct: 15 }
      : stage === "fetching"
        ? { label: "Fetching satellite image...", pct: 35 }
        : stage === "analyzing"
          ? { label: "AI is analyzing your roof...", pct: 78 }
          : null;

  return (
    <section className="space-y-5">
      {stageStep ? (
        <AnalysisProgress step={stageStep.label} pct={stageStep.pct} />
      ) : null}

      {satelliteImage && stage !== "done" ? (
        <div className="relative overflow-hidden rounded-[1.9rem] border border-white/10 bg-slate-950 shadow-[0_28px_100px_rgba(2,8,20,0.55)]">
          <Image
            src={satelliteImage}
            alt={`Satellite view of ${resolvedProperty?.address ?? address}`}
            width={1280}
            height={1280}
            unoptimized
            className="h-[25rem] w-full object-cover opacity-85"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,18,0.16),rgba(4,10,18,0.52))]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/72 px-6 py-4 text-center shadow-[0_18px_50px_rgba(2,8,20,0.35)] backdrop-blur-xl">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                AI roof analysis
              </p>
              <p className="mt-3 text-sm font-medium text-white animate-pulse">
                Analyzing roof geometry...
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Checking roof shape, usable panel zones, pitch, and shading.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "done" && roofData ? (
        <div className="space-y-5">
          <RoofModel3D roofData={roofData} address={resolvedProperty?.address ?? address} />

          <div className="grid gap-4 md:grid-cols-4">
            {cards.map((card) => (
              <EstimateCard key={card.label} label={card.label} value={card.value} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="glass-panel rounded-[1.75rem] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Roof intelligence
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                The AI read this roof as a <span className="font-semibold text-white">{roofData.roofShape}</span> shape
                with about <span className="font-semibold text-white">{getRoofAreaM2(roofData).toFixed(1)} sq m</span> of
                roof area, roughly <span className="font-semibold text-white">{getUsableAreaM2(roofData).toFixed(1)} sq m</span> usable
                for solar, and an estimated <span className="font-semibold text-white">${getMonthlySavings(roofData).toLocaleString()}/mo</span> in savings.
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                {roofData.shadeNote}
              </p>
            </div>

            <div className="glass-panel rounded-[1.75rem] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Confidence
              </p>
              <div className="mt-3 flex items-center justify-between gap-4">
                <p className="text-2xl font-semibold capitalize tracking-tight text-white">
                  {roofData.confidence}
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.26em] text-slate-300">
                  {roofData.source === "vision-api" ? "AI vision" : "Fallback"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {notice ?? roofData.confidenceNote}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "error" ? (
        <div className="rounded-[1.6rem] border border-rose-400/20 bg-rose-950/20 p-5 text-sm leading-7 text-rose-200">
          Could not complete roof analysis: {errorMessage}
        </div>
      ) : null}
    </section>
  );
}

function EstimateCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="glass-panel rounded-[1.5rem] p-4 text-center">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-xl font-semibold capitalize tracking-tight text-white">
        {value}
      </p>
    </article>
  );
}

function AnalysisProgress({ step, pct }: { step: string; pct: number }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.26)] backdrop-blur-xl">
      <p className="text-sm text-slate-300 animate-pulse">{step}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#fbbf24,#fde68a)] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

async function resolveProperty(
  address: string,
  location: { lat?: number; lng?: number } | null | undefined,
  signal: AbortSignal
): Promise<ResolvedProperty> {
  if (Number.isFinite(location?.lat) && Number.isFinite(location?.lng)) {
    return {
      address,
      lat: Number(location?.lat),
      lng: Number(location?.lng),
    };
  }

  const response = await fetch("/api/satellite/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address }),
    signal,
  });
  const payload: SatellitePreviewPayload = await response
    .json()
    .catch(() => ({}));

  if (
    !response.ok ||
    !payload.formattedAddress ||
    !Number.isFinite(payload.lat) ||
    !Number.isFinite(payload.lng)
  ) {
    throw new Error(payload.message || "Could not resolve that property.");
  }

  return {
    address: payload.formattedAddress,
    lat: Number(payload.lat),
    lng: Number(payload.lng),
  };
}
