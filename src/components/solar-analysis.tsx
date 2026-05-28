"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { RoofModel3D } from "@/components/roof-model-3d";
import { ButtonLink } from "@/components/ui/button";
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

type ViewMode = "overview" | "panels" | "irradiance";

type Point = {
  x: number;
  y: number;
};

type PanelRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "panels", label: "Panels" },
  { id: "irradiance", label: "Irradiance" },
];

const azimuthLabels = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

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
  const [resolvedProperty, setResolvedProperty] =
    useState<ResolvedProperty | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");

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
                "Detailed roof analysis was unavailable, so this workspace is using a modeled Arizona estimate."
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

  const overlay = useMemo(() => {
    if (!roofData) {
      return null;
    }

    const footprint = getRoofFootprint(roofData.roofShape);
    const usable = insetPolygon(footprint, 10 - Math.min(roofData.usablePctRoof / 25, 3));
    const panels = buildPanelLayout(roofData, usable);
    const obstructions = getObstructionMarkers(roofData);

    return {
      footprint,
      usable,
      panels,
      obstructions,
    };
  }, [roofData]);

  const metrics = useMemo(() => {
    if (!roofData) {
      return null;
    }

    const roofArea = getRoofAreaM2(roofData);
    const usableArea = getUsableAreaM2(roofData);
    const monthlySavings = getMonthlySavings(roofData);
    const estimatedNetCost = roofData.systemKw * 2550 * 0.74;
    const roiYears = estimatedNetCost / Math.max(roofData.annualSavingsUSD, 1);
    const carbonOffsetLbs = Math.round(roofData.annualKwh * 1.54);
    const carbonOffsetTons = carbonOffsetLbs / 2000;
    const treesEquivalent = Math.max(1, Math.round(carbonOffsetLbs / 48));
    const recommendedSegment =
      [...roofData.roofSegments]
        .sort((left, right) => right.panelsFit - left.panelsFit)
        .find((segment) => segment.usable) ?? roofData.roofSegments[0];

    return {
      roofArea,
      usableArea,
      monthlySavings,
      roiYears,
      carbonOffsetLbs,
      carbonOffsetTons,
      treesEquivalent,
      recommendedSegment,
      financingFrom: Math.round(estimatedNetCost / 300),
      orientationLabel: formatAzimuth(roofData.primaryRoofAzimuth),
    };
  }, [roofData]);

  const stageStep =
    stage === "resolving"
      ? { label: "Resolving property coordinates...", pct: 14 }
      : stage === "fetching"
        ? { label: "Pulling high-zoom rooftop imagery...", pct: 38 }
        : stage === "analyzing"
          ? { label: "Running AI roof intelligence...", pct: 76 }
          : null;

  if (stage === "error") {
    return (
      <section className="space-y-5">
        <div className="rounded-[1.8rem] border border-rose-400/20 bg-rose-950/20 p-6 text-sm leading-7 text-rose-200">
          Could not complete roof analysis: {errorMessage}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {stageStep ? (
        <AnalysisProgress step={stageStep.label} pct={stageStep.pct} />
      ) : null}

      {satelliteImage && stage !== "done" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_22rem]">
          <div className="overflow-hidden rounded-[1.85rem] border border-white/10 bg-slate-950/70 shadow-[0_28px_90px_rgba(2,8,20,0.52)]">
            <ViewportHeader
              address={resolvedProperty?.address ?? address}
              viewMode={viewMode}
              onSelectView={setViewMode}
            />
            <div className="relative min-h-[30rem]">
              <Image
                src={satelliteImage}
                alt={`Satellite view of ${resolvedProperty?.address ?? address}`}
                fill
                unoptimized
                className="object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,15,0.08),rgba(3,8,15,0.64))]" />
              <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(10,18,30,0.72),transparent)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-[1.45rem] border border-cyan-300/18 bg-slate-950/78 px-7 py-5 text-center shadow-[0_18px_60px_rgba(6,12,24,0.45)] backdrop-blur-xl">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                    Analysis in progress
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    Building the roof intelligence layer
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Detecting panel zones, irradiance strength, roof edges, and usable area.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <AnalysisSidebarSkeleton />
        </div>
      ) : null}

      {stage === "done" && roofData && overlay && metrics ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_22rem]">
          <div className="space-y-6">
            <article className="overflow-hidden rounded-[1.95rem] border border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,8,20,0.52)]">
              <ViewportHeader
                address={resolvedProperty?.address ?? address}
                viewMode={viewMode}
                onSelectView={setViewMode}
              />
              <div className="grid border-t border-white/8 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <ViewportCanvas
                  satelliteImage={satelliteImage}
                  address={resolvedProperty?.address ?? address}
                  roofData={roofData}
                  overlay={overlay}
                  metrics={metrics}
                  viewMode={viewMode}
                />
                <div className="border-t border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 lg:border-l lg:border-t-0">
                  <div className="rounded-[1.45rem] border border-white/10 bg-black/20 p-3">
                    <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
                      Volumetric context
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      Secondary 3D model for roof form, panel pitch, and structure context.
                    </p>
                    <RoofModel3D
                      roofData={roofData}
                      address={resolvedProperty?.address ?? address}
                      className="mt-4 h-[16rem] rounded-[1.2rem]"
                    />
                  </div>
                  <LegendPanel roofData={roofData} metrics={metrics} />
                </div>
              </div>
            </article>

            <section className="grid gap-4 lg:grid-cols-3">
              <IntelligenceCard
                eyebrow="AI findings"
                title="Rooftop intelligence summary"
                body={`The primary roof plane faces ${metrics.orientationLabel} with about ${metrics.recommendedSegment?.panelsFit ?? roofData.panelCount} modules fitting on the best-performing segment. The model reads ${roofData.usablePctRoof}% of the roof as usable for solar with ${roofData.shadingRisk} shading exposure.`}
              />
              <IntelligenceCard
                eyebrow="Environmental impact"
                title={`${metrics.carbonOffsetTons.toFixed(1)} tons of annual carbon avoided`}
                body={`That is roughly ${metrics.treesEquivalent} mature trees worth of yearly carbon offset, driven by an estimated ${roofData.annualKwh.toLocaleString()} kWh of solar production.`}
              />
              <IntelligenceCard
                eyebrow="Install strategy"
                title="Recommended installation path"
                body={`Prioritize the ${metrics.recommendedSegment?.label ?? "primary"} roof segment first, reserve lower-performing planes for optional expansion, and keep conduit routing tight to preserve the cleanest visible elevation.`}
              />
            </section>
          </div>

          <aside className="space-y-4">
            <SidebarPanel>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                AI analysis
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Rooftop analysis is ready.
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                The platform mapped roof geometry, candidate panel zones, obstructions, and projected savings from the actual rooftop image.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill label={`${roofData.confidence} confidence`} tone="cyan" />
                <Pill label={`${roofData.source === "vision-api" ? "Vision AI" : "Modeled"} source`} />
                <Pill label={`${metrics.orientationLabel} exposure`} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                {notice ?? roofData.confidenceNote}
              </p>
            </SidebarPanel>

            <SidebarPanel>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Financial model
              </p>
              <div className="mt-4 grid gap-3">
                <MetricRow label="Estimated system size" value={`${roofData.systemKw.toFixed(1)} kW`} />
                <MetricRow label="Estimated panel count" value={`${roofData.panelCount}`} />
                <MetricRow label="Monthly savings" value={`$${metrics.monthlySavings.toLocaleString()}`} />
                <MetricRow label="Yearly savings" value={`$${roofData.annualSavingsUSD.toLocaleString()}`} />
                <MetricRow label="ROI estimate" value={`${metrics.roiYears.toFixed(1)} yrs`} />
                <MetricRow label="Financing from" value={`$${metrics.financingFrom}/mo`} />
              </div>
            </SidebarPanel>

            <SidebarPanel>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Roof segmentation
              </p>
              <div className="mt-4 space-y-3">
                {roofData.roofSegments.slice(0, 3).map((segment) => (
                  <div key={segment.label} className="rounded-[1.15rem] border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold capitalize text-white">
                        {segment.label}
                      </p>
                      <p className="text-[0.65rem] uppercase tracking-[0.24em] text-slate-400">
                        {segment.panelsFit} panels
                      </p>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#38bdf8)]"
                        style={{
                          width: `${Math.max(
                            22,
                            Math.min(
                              100,
                              Math.round(
                                (segment.panelsFit / Math.max(roofData.panelCount, 1)) * 100
                              )
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <span>{segment.areaM2.toFixed(1)} sq m</span>
                      <span>{formatAzimuth(segment.azimuthDeg)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </SidebarPanel>

            <SidebarPanel className="bg-[linear-gradient(180deg,rgba(103,232,249,0.1),rgba(255,255,255,0.02))]">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Next step
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
                Turn this into a full homeowner report.
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Capture the property details, savings range, and installation recommendation in a shareable solar proposal.
              </p>
              <div className="mt-5 grid gap-3">
                <ButtonLink href="#contact" variant="primary" className="w-full">
                  Generate full report
                </ButtonLink>
                <ButtonLink href="tel:+16025550100" variant="secondary" className="w-full">
                  Talk to a solar advisor
                </ButtonLink>
              </div>
            </SidebarPanel>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function ViewportHeader({
  address,
  viewMode,
  onSelectView,
}: {
  address: string;
  viewMode: ViewMode;
  onSelectView: (next: ViewMode) => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Rooftop analysis workspace
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Satellite imagery is the primary analysis layer, with AI overlays for roof polygons, panel placement, and irradiance guidance.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
          {address}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {viewModes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelectView(mode.id)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition ${
              viewMode === mode.id
                ? "bg-cyan-300 text-slate-950 shadow-[0_14px_40px_rgba(34,211,238,0.18)]"
                : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ViewportCanvas({
  satelliteImage,
  address,
  roofData,
  overlay,
  metrics,
  viewMode,
}: {
  satelliteImage: string | null;
  address: string;
  roofData: RoofAnalysis;
  overlay: {
    footprint: Point[];
    usable: Point[];
    panels: PanelRect[];
    obstructions: Point[];
  };
  metrics: {
    roofArea: number;
    usableArea: number;
    monthlySavings: number;
    roiYears: number;
    carbonOffsetLbs: number;
    carbonOffsetTons: number;
    treesEquivalent: number;
    recommendedSegment?: RoofAnalysis["roofSegments"][number];
    financingFrom: number;
    orientationLabel: string;
  };
  viewMode: ViewMode;
}) {
  const footprintPoints = pointsToString(overlay.footprint);
  const usablePoints = pointsToString(overlay.usable);
  const showPanels = viewMode === "overview" || viewMode === "panels";
  const showHeatmap = viewMode === "overview" || viewMode === "irradiance";
  const showObstructions = viewMode === "overview" || viewMode === "irradiance";

  return (
    <div className="relative min-h-[34rem] overflow-hidden bg-slate-950">
      {satelliteImage ? (
        <Image
          src={satelliteImage}
          alt={`Satellite view of ${address}`}
          fill
          unoptimized
          className="object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,8,16,0.1),rgba(4,8,16,0.68))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_85%_22%,rgba(16,185,129,0.16),transparent_26%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_32%)]" />

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="usable-roof-zone">
            <polygon points={usablePoints} />
          </clipPath>
          <radialGradient id="irradiance-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.8)" />
            <stop offset="40%" stopColor="rgba(250, 204, 21, 0.45)" />
            <stop offset="100%" stopColor="rgba(34, 211, 238, 0.06)" />
          </radialGradient>
          <linearGradient id="usable-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(34, 211, 238, 0.36)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0.16)" />
          </linearGradient>
        </defs>

        {showHeatmap ? (
          <>
            <ellipse
              cx="48"
              cy="46"
              rx="24"
              ry="18"
              fill="url(#irradiance-core)"
              opacity="0.9"
            />
            <ellipse
              cx="61"
              cy="40"
              rx="12"
              ry="9"
              fill="rgba(250, 204, 21, 0.22)"
            />
          </>
        ) : null}

        <polygon
          points={footprintPoints}
          fill="rgba(3, 7, 18, 0.12)"
          stroke="rgba(103, 232, 249, 0.95)"
          strokeWidth="0.6"
          strokeDasharray="1.3 1.1"
        />
        <polygon
          points={usablePoints}
          fill="url(#usable-fill)"
          stroke="rgba(255,255,255,0.38)"
          strokeWidth="0.45"
        />

        <g clipPath="url(#usable-roof-zone)">
          {showPanels
            ? overlay.panels.map((panel) => (
                <rect
                  key={panel.id}
                  x={panel.x}
                  y={panel.y}
                  width={panel.width}
                  height={panel.height}
                  rx="0.22"
                  fill={viewMode === "panels" ? "rgba(252, 211, 77, 0.9)" : "rgba(37, 99, 235, 0.76)"}
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth="0.14"
                  transform={`rotate(${panel.rotation} ${panel.x + panel.width / 2} ${
                    panel.y + panel.height / 2
                  })`}
                />
              ))
            : null}
        </g>

        {showObstructions
          ? overlay.obstructions.map((point, index) => (
              <g key={`${point.x}-${point.y}-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="1.8"
                  fill="rgba(15, 23, 42, 0.75)"
                  stroke="rgba(248, 113, 113, 0.75)"
                  strokeWidth="0.24"
                />
                <circle cx={point.x} cy={point.y} r="0.65" fill="rgba(248, 113, 113, 0.85)" />
              </g>
            ))
          : null}

        <line x1="50" y1="12" x2="50" y2="88" stroke="rgba(255,255,255,0.14)" strokeWidth="0.14" />
        <line x1="18" y1="50" x2="82" y2="50" stroke="rgba(255,255,255,0.14)" strokeWidth="0.14" />
      </svg>

      <div className="absolute left-4 top-4 flex flex-wrap gap-2">
        <StatusBadge label="Roof polygon detected" tone="cyan" />
        <StatusBadge label={`${roofData.panelCount} panel layout`} tone="amber" />
        <StatusBadge label={`${metrics.orientationLabel} exposure`} />
      </div>

      <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-3">
        <HudCard label="Usable roof area" value={`${metrics.usableArea.toFixed(1)} sq m`} />
        <HudCard label="Estimated monthly savings" value={`$${metrics.monthlySavings.toLocaleString()}`} />
        <HudCard label="Recommended segment" value={metrics.recommendedSegment?.label ?? "Primary"} />
      </div>
    </div>
  );
}

function LegendPanel({
  roofData,
  metrics,
}: {
  roofData: RoofAnalysis;
  metrics: {
    roofArea: number;
    usableArea: number;
    monthlySavings: number;
    roiYears: number;
    carbonOffsetLbs: number;
    carbonOffsetTons: number;
    treesEquivalent: number;
    recommendedSegment?: RoofAnalysis["roofSegments"][number];
    financingFrom: number;
    orientationLabel: string;
  };
}) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
        Overlay legend
      </p>
      <LegendRow swatch="bg-cyan-300" label="Roof edge and usable area" />
      <LegendRow swatch="bg-blue-500" label="Panel placement candidates" />
      <LegendRow swatch="bg-amber-400" label="High-irradiance roof region" />
      <LegendRow swatch="bg-rose-400" label="Obstruction or shade marker" />
      <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.03] p-3 text-sm leading-6 text-slate-300">
        {roofData.panelCount} modules fit across about {metrics.usableArea.toFixed(1)} sq m of usable roof area. Estimated payback is about {metrics.roiYears.toFixed(1)} years.
      </div>
    </div>
  );
}

function AnalysisSidebarSkeleton() {
  return (
    <aside className="space-y-4">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(2,8,20,0.28)] backdrop-blur-xl"
        >
          <div className="h-3 w-24 rounded-full bg-white/10" />
          <div className="mt-4 h-7 w-40 rounded-full bg-white/10" />
          <div className="mt-3 h-20 rounded-[1rem] bg-white/[0.04]" />
        </div>
      ))}
    </aside>
  );
}

function SidebarPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(2,8,20,0.28)] backdrop-blur-xl ${className}`.trim()}
    >
      {children}
    </article>
  );
}

function IntelligenceCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(2,8,20,0.24)] backdrop-blur-xl transition hover:-translate-y-1 hover:bg-white/[0.06]">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
        {eyebrow}
      </p>
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-7 text-slate-300">{body}</p>
    </article>
  );
}

function AnalysisProgress({ step, pct }: { step: string; pct: number }) {
  return (
    <div className="rounded-[1.55rem] border border-white/10 bg-white/[0.05] p-4 shadow-[0_18px_50px_rgba(2,8,20,0.26)] backdrop-blur-xl">
      <p className="text-sm text-slate-300 animate-pulse">{step}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#0ea5e9,#67e8f9,#fcd34d)] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function HudCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/68 px-3 py-3 shadow-[0_14px_40px_rgba(2,8,20,0.28)] backdrop-blur-xl">
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.28em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function LegendRow({
  swatch,
  label,
}: {
  swatch: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-300">
      <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
      <span>{label}</span>
    </div>
  );
}

function Pill({ label, tone = "slate" }: { label: string; tone?: "slate" | "cyan" | "amber" }) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
      : tone === "amber"
        ? "border-amber-300/18 bg-amber-300/10 text-amber-100"
        : "border-white/10 bg-white/[0.05] text-slate-200";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.26em] ${toneClass}`.trim()}
    >
      {label}
    </span>
  );
}

function StatusBadge({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "slate" | "cyan" | "amber";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
      : tone === "amber"
        ? "border-amber-300/18 bg-amber-300/10 text-amber-100"
        : "border-white/10 bg-slate-950/62 text-slate-200";

  return (
    <span
      className={`rounded-full border px-3 py-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.26em] shadow-[0_12px_30px_rgba(2,8,20,0.28)] backdrop-blur-md ${toneClass}`.trim()}
    >
      {label}
    </span>
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

function getRoofFootprint(shape: RoofAnalysis["roofShape"]): Point[] {
  switch (shape) {
    case "complex":
      return [
        { x: 20, y: 24 },
        { x: 68, y: 18 },
        { x: 80, y: 32 },
        { x: 75, y: 62 },
        { x: 62, y: 68 },
        { x: 58, y: 80 },
        { x: 28, y: 78 },
        { x: 18, y: 58 },
      ];
    case "hip":
      return [
        { x: 26, y: 24 },
        { x: 72, y: 24 },
        { x: 80, y: 38 },
        { x: 73, y: 73 },
        { x: 27, y: 73 },
        { x: 20, y: 38 },
      ];
    case "shed":
      return [
        { x: 24, y: 30 },
        { x: 74, y: 22 },
        { x: 82, y: 64 },
        { x: 31, y: 72 },
      ];
    case "flat":
      return [
        { x: 23, y: 28 },
        { x: 77, y: 28 },
        { x: 77, y: 72 },
        { x: 23, y: 72 },
      ];
    case "gable":
    default:
      return [
        { x: 24, y: 26 },
        { x: 76, y: 26 },
        { x: 79, y: 66 },
        { x: 50, y: 76 },
        { x: 21, y: 66 },
      ];
  }
}

function insetPolygon(points: Point[], inset: number): Point[] {
  const center = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x / points.length,
      y: accumulator.y + point.y / points.length,
    }),
    { x: 0, y: 0 }
  );

  return points.map((point) => ({
    x: point.x + ((center.x - point.x) * inset) / 100,
    y: point.y + ((center.y - point.y) * inset) / 100,
  }));
}

function buildPanelLayout(analysis: RoofAnalysis, polygon: Point[]): PanelRect[] {
  const bounds = polygon.reduce(
    (accumulator, point) => ({
      minX: Math.min(accumulator.minX, point.x),
      maxX: Math.max(accumulator.maxX, point.x),
      minY: Math.min(accumulator.minY, point.y),
      maxY: Math.max(accumulator.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );

  const usableWidth = Math.max(bounds.maxX - bounds.minX - 6, 12);
  const usableHeight = Math.max(bounds.maxY - bounds.minY - 6, 10);
  const columns = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(analysis.panelCount * 1.15))));
  const rows = Math.max(1, Math.ceil(analysis.panelCount / columns));
  const gap = 0.75;
  const panelWidth = (usableWidth - gap * (columns - 1)) / columns;
  const panelHeight = Math.min(4.2, Math.max(2.8, usableHeight / (rows + 1.6)));
  const startX = bounds.minX + 3;
  const startY = bounds.minY + 3;
  const rotation = clampNumber((analysis.primaryRoofAzimuth - 180) / 10, -16, 16);

  return Array.from({ length: analysis.panelCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      id: `panel-${index}`,
      x: startX + column * (panelWidth + gap),
      y: startY + row * (panelHeight + gap * 0.9),
      width: panelWidth,
      height: panelHeight,
      rotation,
    };
  });
}

function getObstructionMarkers(analysis: RoofAnalysis): Point[] {
  if (analysis.shadingRisk === "low") {
    return [{ x: 26, y: 24 }];
  }

  if (analysis.shadingRisk === "medium") {
    return [
      { x: 24, y: 26 },
      { x: 75, y: 30 },
    ];
  }

  return [
    { x: 24, y: 24 },
    { x: 73, y: 28 },
    { x: 67, y: 70 },
  ];
}

function pointsToString(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function formatAzimuth(value: number) {
  const normalized = ((value % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return azimuthLabels[index];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
