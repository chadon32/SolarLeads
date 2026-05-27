"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";

type SatellitePreviewProps = {
  address?: string;
  onAnalysisChange?: (analysis: RoofAnalysis | null) => void;
};

type SatellitePayload = {
  formattedAddress: string;
  imageUrl: string;
  lat: number;
  lng: number;
  analysis?: RoofAnalysis;
  message?: string;
};

const fallbackAnalysis: RoofAnalysis = {
  zoom: 20,
  usableRoofPercent: 72,
  estimatedPanelCount: 22,
  estimatedSystemSizeKw: 9.2,
  estimatedAnnualSavings: 2346,
  estimatedMonthlySavings: 196,
  estimatedRoofAreaSqm: 60.1,
  estimatedUsableSolarAreaSqm: 43.3,
  estimatedRoofLengthMeters: 9.9,
  estimatedRoofWidthMeters: 6.1,
  roofPitchDegrees: 22,
  confidence: "medium",
};

export function SatellitePreview({
  address,
  onAnalysisChange,
}: SatellitePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displayAddress, setDisplayAddress] = useState(address ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RoofAnalysis>(fallbackAnalysis);

  useEffect(() => {
    const trimmed = address?.trim();

    if (!trimmed) {
      const reset = window.setTimeout(() => {
        setImageUrl(null);
        setDisplayAddress("");
        setError(null);
        setAnalysis(fallbackAnalysis);
        onAnalysisChange?.(null);
        setLoading(false);
      }, 0);

      return () => window.clearTimeout(reset);
    }

    const controller = new AbortController();
    let fetchTimer = 0;
    const startTimer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      fetchTimer = window.setTimeout(async () => {
        try {
          const response = await fetch("/api/satellite/preview", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ address: trimmed }),
            signal: controller.signal,
          });

          const payload: SatellitePayload = await response
            .json()
            .catch(() => ({} as SatellitePayload));

          if (!response.ok) {
            setImageUrl(null);
            setDisplayAddress(trimmed);
            setError(payload.message ?? "We couldn't find that address.");
            setAnalysis(fallbackAnalysis);
            onAnalysisChange?.(fallbackAnalysis);
            setLoading(false);
            return;
          }

          const nextAnalysis = payload.analysis ?? fallbackAnalysis;
          setImageUrl(payload.imageUrl);
          setDisplayAddress(payload.formattedAddress);
          setAnalysis(nextAnalysis);
          onAnalysisChange?.(nextAnalysis);
          setLoading(false);
        } catch (caughtError) {
          if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
            return;
          }

          setImageUrl(null);
          setDisplayAddress(trimmed);
          setError("Satellite preview is temporarily unavailable.");
          setAnalysis(fallbackAnalysis);
          onAnalysisChange?.(fallbackAnalysis);
          setLoading(false);
        }
      }, 240);
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(startTimer);
      window.clearTimeout(fetchTimer);
    };
  }, [address, onAnalysisChange]);

  const confidenceLabel =
    analysis.confidence === "high"
      ? "high confidence"
      : analysis.confidence === "medium"
        ? "good roof read"
        : "partial read";

  return (
    <section className="mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 shadow-[0_18px_50px_rgba(2,8,20,0.26)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Satellite preview
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {displayAddress || "Select an Arizona address to begin."}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.26em] text-slate-300">
          {loading ? "Scanning" : imageUrl ? "Ready" : "Idle"}
        </span>
      </div>

      <div className="relative aspect-[4/3] overflow-hidden bg-slate-950 sm:aspect-[16/9]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={`Satellite view of ${displayAddress}`}
            fill
            sizes="(max-width: 1024px) 100vw, 40vw"
            className="object-cover"
            unoptimized
            priority={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto h-12 w-12 rounded-full border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_30px_rgba(103,232,249,0.2)]" />
              <p className="mt-4 text-sm font-medium text-white">
                {loading ? "Generating roof analysis..." : "Roof analysis will appear here."}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {error ?? "Select a valid address to load a roof-centered satellite analysis."}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 border-t border-white/8 bg-slate-950/30 p-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/72 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.45)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                AI Roof Analysis
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-200">
                {loading
                  ? "Generating rooftop detail..."
                  : "High-zoom roof image ready for analysis."}
              </p>
            </div>
            <div className="analysis-orbit h-10 w-10 rounded-full border border-cyan-300/20 bg-cyan-300/10" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricChip label="System" value={`${analysis.estimatedSystemSizeKw.toFixed(1)} kW`} />
            <MetricChip label="Monthly" value={`$${analysis.estimatedMonthlySavings.toLocaleString()}`} />
            <MetricChip label="Yearly" value={`$${analysis.estimatedAnnualSavings.toLocaleString()}`} />
            <MetricChip label="Usable" value={`${analysis.usableRoofPercent}%`} />
          </div>

          <div className="mt-4 rounded-[1rem] border border-emerald-400/18 bg-emerald-400/6 p-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">
              <span>Roof summary</span>
              <span>{confidenceLabel}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-200">
              Estimated {analysis.estimatedPanelCount} panels fit on the primary roof plane with a
              modeled system size of {analysis.estimatedSystemSizeKw.toFixed(1)} kW.
            </p>
            <p
              className="mt-3 text-xs leading-6 text-slate-400"
              title="This is a modeled estimate. Your final report will include measurements specific to your roof."
            >
              Estimated based on typical Arizona rooftops.
            </p>
          </div>
        </div>

        <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/72 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.45)] backdrop-blur-xl">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Roof geometry
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <GeometryCard
              label="Estimated roof area"
              value={`${analysis.estimatedRoofAreaSqm.toFixed(1)} sq m`}
            />
            <GeometryCard
              label="Usable solar area"
              value={`${analysis.estimatedUsableSolarAreaSqm.toFixed(1)} sq m`}
            />
            <GeometryCard
              label="Roof dimensions"
              value={`${analysis.estimatedRoofLengthMeters.toFixed(1)}m x ${analysis.estimatedRoofWidthMeters.toFixed(1)}m`}
            />
            <GeometryCard
              label="Roof pitch"
              value={`${analysis.roofPitchDegrees.toFixed(0)} deg`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function GeometryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
