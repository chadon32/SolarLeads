"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import {
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

type SolarDataLayersPayload = {
  annualFluxUrl?: string | null;
  imageryQuality?: string | null;
  message?: string;
};

type AnalyzeRoofPayload = {
  analysis?: RoofAnalysis;
  fallback?: RoofAnalysis;
  message?: string;
  detail?: string;
};

type ViewMode = "overview" | "panels" | "irradiance";

type GoogleLatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMapsMap = {
  setCenter(center: GoogleLatLngLiteral): void;
};

type GoogleMapsProjection = {
  fromLatLngToDivPixel(location: GoogleLatLngLiteral): { x: number; y: number } | null;
};

type GoogleMapsPanes = {
  overlayLayer: HTMLElement;
};

type GoogleMapsOverlayView = {
  setMap(map: GoogleMapsMap | null): void;
  getPanes(): GoogleMapsPanes | null;
  getProjection(): GoogleMapsProjection | null;
  onAdd?: () => void;
  draw?: () => void;
  onRemove?: () => void;
};

type GoogleMapsNamespace = {
  Map: new (element: HTMLElement, options: GoogleMapsMapOptions) => GoogleMapsMap;
  OverlayView: new () => GoogleMapsOverlayView;
};

type GoogleMapsMapOptions = {
  center: GoogleLatLngLiteral;
  zoom: number;
  mapTypeId: string;
  disableDefaultUI: boolean;
  clickableIcons: boolean;
  gestureHandling: "none" | "cooperative" | "greedy" | "auto";
  keyboardShortcuts: boolean;
  scrollwheel: boolean;
  tilt: number;
};

type AnalysisMetrics = {
  roofArea: number;
  usableArea: number;
  selectedPanelCount: number;
  selectedSystemKw: number;
  selectedAnnualKwh: number;
  selectedAnnualSavingsUSD: number;
  monthlySavings: number;
  roiYears: number;
  carbonOffsetLbs: number;
  carbonOffsetTons: number;
  treesEquivalent: number;
  recommendedSegment?: RoofAnalysis["roofSegments"][number];
  financingFrom: number;
  orientationLabel: string;
};

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

type MeasurementLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  label: string;
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
    "idle" | "resolving" | "fetching" | "analyzing" | "done" | "invalid" | "error"
  >("idle");
  const [satelliteImage, setSatelliteImage] = useState<string | null>(null);
  const [annualFluxUrl, setAnnualFluxUrl] = useState<string | null>(null);
  const [roofData, setRoofData] = useState<RoofAnalysis | null>(null);
  const [resolvedProperty, setResolvedProperty] =
    useState<ResolvedProperty | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [selectedPanelCount, setSelectedPanelCount] = useState<number>(0);

  useEffect(() => {
    const trimmedAddress = address.trim();

    if (!trimmedAddress) {
      const resetHandle = window.requestAnimationFrame(() => {
        setStage("idle");
        setSatelliteImage(null);
        setAnnualFluxUrl(null);
        setRoofData(null);
        setSelectedPanelCount(0);
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
        setAnnualFluxUrl(null);
        onAnalysisChange?.(null);

        const property = await resolveProperty(
          trimmedAddress,
          controller.signal
        );

        if (cancelled) {
          return;
        }

        setResolvedProperty(property);
        setStage("fetching");

        const [imageResponse, dataLayersResponse] = await Promise.all([
          fetch(
            `/api/satellite-image?lat=${encodeURIComponent(
              property.lat
            )}&lng=${encodeURIComponent(property.lng)}`,
            {
              signal: controller.signal,
            }
          ),
          fetch(
            `/api/solar/data-layers?lat=${encodeURIComponent(
              property.lat
            )}&lng=${encodeURIComponent(property.lng)}`,
            {
              signal: controller.signal,
            }
          ).catch(() => null),
        ]);
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
        if (dataLayersResponse?.ok) {
          const dataLayersPayload: SolarDataLayersPayload = await dataLayersResponse
            .json()
            .catch(() => ({}));
          setAnnualFluxUrl(dataLayersPayload.annualFluxUrl ?? null);
        } else {
          setAnnualFluxUrl(null);
        }
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

        const nextRoofData = analysisPayload.analysis;

        if (!analysisResponse.ok || !nextRoofData) {
          const message =
            analysisPayload.message ??
            analysisPayload.detail ??
            "A usable residential rooftop could not be confirmed for this address.";

          setStage("invalid");
          setRoofData(nextRoofData ?? null);
          onAnalysisChange?.(nextRoofData ?? null);
          setErrorMessage(message);
          return;
        }

        if (!nextRoofData.validSite || !nextRoofData.rooftopDetected) {
          setRoofData(nextRoofData);
          onAnalysisChange?.(nextRoofData);
          setStage("invalid");
          setErrorMessage(
            analysisPayload.message ??
              nextRoofData.invalidReason ??
              "A usable residential rooftop could not be confirmed for this address."
          );
          return;
        }

        setRoofData(nextRoofData);
        setSelectedPanelCount(
          Math.max(
            1,
            Math.min(
              nextRoofData.panelCount,
              nextRoofData.solarPanels.length || nextRoofData.panelCount
            )
          )
        );
        onAnalysisChange?.(nextRoofData);
        setStage("done");
        setNotice(
          nextRoofData.confidence !== "high" ? nextRoofData.confidenceNote : null
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

    const footprint =
      roofData.roofOutline.length >= 3 ? roofData.roofOutline : [];
    const usable =
      roofData.usableOutline.length >= 3 ? roofData.usableOutline : footprint;
    const panels = buildPanelLayout(roofData, usable);
    const obstructions = roofData.obstructionOutlines;
    const bounds = getBounds(footprint);
    const measurements = buildMeasurementLines(footprint, bounds, roofData);

    return {
      footprint,
      usable,
      panels,
      obstructions,
      bounds,
      measurements,
    };
  }, [roofData]);

  const selectedPanels = useMemo(() => {
    if (!roofData) {
      return [];
    }

    const maxSelectablePanels = Math.max(
      1,
      Math.min(roofData.panelCount, roofData.solarPanels.length || roofData.panelCount)
    );
    const count = clampNumber(selectedPanelCount || maxSelectablePanels, 1, maxSelectablePanels);

    return roofData.solarPanels.slice(0, count);
  }, [roofData, selectedPanelCount]);

  const metrics = useMemo(() => {
    if (!roofData) {
      return null;
    }

    const roofArea = getRoofAreaM2(roofData);
    const usableArea = getUsableAreaM2(roofData);
    const panelCapacityWatts = roofData.panelCapacityWatts || 400;
    const livePanelCount = clampNumber(
      selectedPanelCount || roofData.panelCount,
      1,
      Math.max(1, roofData.panelCount)
    );
    const totalAnnualKwh =
      selectedPanels.length > 0
        ? selectedPanels.reduce(
            (sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0),
            0
          )
        : roofData.annualKwh;
    const perPanelKwh =
      roofData.panelCount > 0 ? totalAnnualKwh / Math.max(roofData.panelCount, 1) : 0;
    const selectedAnnualKwh = Math.max(
      0,
      Math.round(
        selectedPanels.length > 0
          ? totalAnnualKwh
          : perPanelKwh * livePanelCount
      )
    );
    const selectedAnnualSavingsUSD = Math.round(selectedAnnualKwh * 0.13);
    const selectedSystemKw = Math.round(((livePanelCount * panelCapacityWatts) / 1000) * 10) / 10;
    const monthlySavings = Math.round(selectedAnnualSavingsUSD / 12);
    const estimatedNetCost = selectedSystemKw * 2550 * 0.74;
    const roiYears = estimatedNetCost / Math.max(selectedAnnualSavingsUSD, 1);
    const carbonOffsetLbs = Math.round(selectedAnnualKwh * 1.54);
    const carbonOffsetTons = carbonOffsetLbs / 2000;
    const treesEquivalent = Math.max(1, Math.round(carbonOffsetLbs / 48));
    const recommendedSegment =
      [...roofData.roofSegments]
        .sort((left, right) => right.panelsFit - left.panelsFit)
        .find((segment) => segment.usable) ?? roofData.roofSegments[0];

    return {
      roofArea,
      usableArea,
      selectedPanelCount: livePanelCount,
      selectedSystemKw,
      selectedAnnualKwh,
      selectedAnnualSavingsUSD,
      monthlySavings,
      roiYears,
      carbonOffsetLbs,
      carbonOffsetTons,
      treesEquivalent,
      recommendedSegment,
      financingFrom: Math.round(estimatedNetCost / 300),
      orientationLabel: formatAzimuth(roofData.primaryRoofAzimuth),
    };
  }, [roofData, selectedPanels, selectedPanelCount]);

  const stageStep =
    stage === "resolving"
      ? { label: "Resolving property coordinates...", pct: 14 }
      : stage === "fetching"
        ? { label: "Pulling high-zoom rooftop imagery...", pct: 38 }
        : stage === "analyzing"
          ? { label: "Running roof analysis...", pct: 76 }
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

  if (stage === "invalid") {
    return (
      <section className="space-y-5">
        <div className="rounded-[1.8rem] border border-amber-400/20 bg-amber-950/18 p-6">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-amber-300">
            Rooftop validation failed
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            A usable residential roof was not confirmed for this address.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            {errorMessage}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MetricRow label="Property type" value={roofData?.propertyType ?? "unknown"} />
            <MetricRow
              label="Roof detected"
              value={roofData?.rooftopDetected ? "Yes" : "No"}
            />
            <MetricRow label="Confidence" value={roofData?.confidence ?? "low"} />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-400">
            Try a detached house address with a clearly visible rooftop in the satellite image.
          </p>
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
          <div className="overflow-hidden rounded-[1.85rem] border border-white/10 bg-slate-950/76 shadow-[0_12px_42px_rgba(2,8,20,0.36)]">
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
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,15,0.1),rgba(3,8,15,0.72))]" />
              <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(10,18,30,0.72),transparent)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-[1.45rem] border border-white/10 bg-slate-950/84 px-7 py-5 text-center shadow-[0_12px_36px_rgba(6,12,24,0.34)] backdrop-blur-xl">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                    Processing
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    Building the roof analysis view
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Measuring roof edges, usable area, and likely panel zones.
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
            <article className="overflow-hidden rounded-[1.95rem] border border-white/10 bg-slate-950/78 shadow-[0_14px_44px_rgba(2,8,20,0.36)]">
              <ViewportHeader
                address={resolvedProperty?.address ?? address}
                viewMode={viewMode}
                onSelectView={setViewMode}
              />
              <div className="grid border-t border-white/8 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <ViewportCanvas
                  satelliteImage={satelliteImage}
                  annualFluxUrl={annualFluxUrl}
                  address={resolvedProperty?.address ?? address}
                  roofData={roofData}
                  overlay={overlay}
                  metrics={metrics}
                  viewMode={viewMode}
                />
                <div className="border-t border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 lg:border-l lg:border-t-0">
                  <PanelSelectionSlider
                    value={metrics.selectedPanelCount}
                    max={roofData.panelCount}
                    onChange={setSelectedPanelCount}
                  />
                  <PanelMapPreview
                    address={resolvedProperty?.address ?? address}
                    lat={resolvedProperty?.lat ?? 0}
                    lng={resolvedProperty?.lng ?? 0}
                    roofData={roofData}
                    selectedPanels={selectedPanels}
                  />
                  <MeasurementPanel roofData={roofData} metrics={metrics} />
                  <LegendPanel roofData={roofData} metrics={metrics} />
                </div>
              </div>
            </article>

            <section className="grid gap-4 lg:grid-cols-3">
              <IntelligenceCard
                eyebrow="Site findings"
                title="Rooftop analysis summary"
                body={`The primary roof plane faces ${metrics.orientationLabel} with about ${metrics.selectedPanelCount} modules selected on the map preview. The current analysis reads ${roofData.usablePctRoof}% of the roof as usable for solar with ${roofData.shadingRisk} shading exposure.`}
              />
              <IntelligenceCard
                eyebrow="Environmental impact"
                title={`${metrics.carbonOffsetTons.toFixed(1)} tons of annual carbon avoided`}
                body={`That is roughly ${metrics.treesEquivalent} mature trees worth of yearly carbon offset, driven by an estimated ${metrics.selectedAnnualKwh.toLocaleString()} kWh of solar production.`}
              />
              <IntelligenceCard
                eyebrow="Install strategy"
                title="Recommended installation approach"
                body={`Prioritize the ${metrics.recommendedSegment?.label ?? "primary"} roof segment first, reserve lower-performing planes for optional expansion, and keep conduit routing tight to reduce visible clutter on the front elevation.`}
              />
            </section>
          </div>

          <aside className="space-y-4">
            <SidebarPanel>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Analysis summary
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Rooftop analysis is ready.
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                The platform mapped roof geometry, candidate panel zones, obstructions, and projected savings from the rooftop image.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill label={`${roofData.confidence} confidence`} tone="cyan" />
                <Pill
                  label={
                    roofData.source === "solar-api"
                      ? "Solar API source"
                      : roofData.source === "vision-api"
                        ? "Image analysis"
                        : "Modeled source"
                  }
                />
                <Pill label={`${metrics.orientationLabel} orientation`} />
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
                <MetricRow label="Estimated system size" value={`${metrics.selectedSystemKw.toFixed(1)} kW`} />
                <MetricRow label="Estimated panel count" value={`${metrics.selectedPanelCount}`} />
                <MetricRow label="Monthly savings" value={`$${metrics.monthlySavings.toLocaleString()}`} />
                <MetricRow label="Yearly savings" value={`$${metrics.selectedAnnualSavingsUSD.toLocaleString()}`} />
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
                Report delivery
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
                Convert this analysis into a homeowner report.
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Capture the property details, modeled savings, and installation recommendation in a shareable solar proposal.
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
            Rooftop analysis
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Satellite imagery is the primary analysis layer, with roof polygons, panel placement, and irradiance guidance overlaid directly on the property.
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
                ? "bg-cyan-300 text-slate-950"
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
  annualFluxUrl,
  address,
  roofData,
  overlay,
  metrics,
  viewMode,
}: {
  satelliteImage: string | null;
  annualFluxUrl: string | null;
  address: string;
  roofData: RoofAnalysis;
  overlay: {
    footprint: Point[];
    usable: Point[];
    panels: PanelRect[];
    obstructions: Point[][];
    bounds: Bounds;
    measurements: MeasurementLine[];
  };
  metrics: AnalysisMetrics;
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
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,18,0.02),rgba(6,10,18,0.18))]" />
      <AnnualFluxCanvasOverlay annualFluxUrl={annualFluxUrl} viewMode={viewMode} />

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
          {roofData.roofSegments
            .filter((segment) => segment.outline.length >= 3)
            .map((segment) => (
              <g key={`segment-${segment.label}`}>
                <polygon
                  points={pointsToString(segment.outline)}
                  fill={segment.usable ? "rgba(255,255,255,0.05)" : "rgba(248,113,113,0.08)"}
                  stroke={segment.usable ? "rgba(255,255,255,0.32)" : "rgba(248,113,113,0.42)"}
                  strokeWidth="0.18"
                />
                <text
                  x={getPolygonCenter(segment.outline).x}
                  y={getPolygonCenter(segment.outline).y - 0.7}
                  textAnchor="middle"
                  fontSize="1.05"
                  fill="rgba(255,255,255,0.84)"
                  letterSpacing="0.08em"
                >
                  {segment.label.toUpperCase()}
                </text>
                <text
                  x={getPolygonCenter(segment.outline).x}
                  y={getPolygonCenter(segment.outline).y + 1.1}
                  textAnchor="middle"
                  fontSize="0.86"
                  fill="rgba(255,255,255,0.72)"
                  letterSpacing="0.04em"
                >
                  {`${segment.areaM2.toFixed(1)} sq m`}
                </text>
              </g>
            ))}
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
          ? overlay.obstructions.map((zone, index) => (
              <g key={`zone-${index}`}>
                <polygon
                  points={pointsToString(zone)}
                  fill="rgba(248,113,113,0.18)"
                  stroke="rgba(248,113,113,0.78)"
                  strokeWidth="0.22"
                  strokeDasharray="0.8 0.6"
                />
              </g>
            ))
          : null}

        {overlay.measurements.map((measurement) => (
          <g key={measurement.id}>
            <line
              x1={measurement.x1}
              y1={measurement.y1}
              x2={measurement.x2}
              y2={measurement.y2}
              stroke="rgba(255,255,255,0.82)"
              strokeWidth="0.24"
            />
            <line
              x1={measurement.x1}
              y1={measurement.y1}
              x2={measurement.x1 + (measurement.x1 === measurement.x2 ? -1.1 : 0)}
              y2={measurement.y1 + (measurement.y1 === measurement.y2 ? -1.1 : 0)}
              stroke="rgba(255,255,255,0.82)"
              strokeWidth="0.24"
            />
            <line
              x1={measurement.x2}
              y1={measurement.y2}
              x2={measurement.x2 + (measurement.x1 === measurement.x2 ? -1.1 : 0)}
              y2={measurement.y2 + (measurement.y1 === measurement.y2 ? -1.1 : 0)}
              stroke="rgba(255,255,255,0.82)"
              strokeWidth="0.24"
            />
            <rect
              x={measurement.labelX - 5.8}
              y={measurement.labelY - 2}
              width="11.6"
              height="4"
              rx="1.2"
              fill="rgba(8, 12, 20, 0.82)"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="0.12"
            />
            <text
              x={measurement.labelX}
              y={measurement.labelY + 0.35}
              textAnchor="middle"
              fontSize="1.25"
              fill="rgba(255,255,255,0.92)"
              letterSpacing="0.06em"
            >
              {measurement.label}
            </text>
          </g>
        ))}

        <line x1="50" y1="12" x2="50" y2="88" stroke="rgba(255,255,255,0.14)" strokeWidth="0.14" />
        <line x1="18" y1="50" x2="82" y2="50" stroke="rgba(255,255,255,0.14)" strokeWidth="0.14" />
      </svg>

      <div className="absolute left-4 top-4 flex flex-wrap gap-2">
        <StatusBadge label="Roof polygon detected" tone="cyan" />
        <StatusBadge label={`${roofData.panelCount} panel layout`} tone="amber" />
        <StatusBadge label={`${metrics.orientationLabel} orientation`} />
      </div>

      <div className="absolute right-4 top-20 rounded-[1rem] border border-white/10 bg-slate-950/76 px-3 py-3 text-xs text-slate-200 shadow-[0_10px_24px_rgba(2,8,20,0.18)] backdrop-blur-xl">
        <p className="text-[0.56rem] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Measured roof
        </p>
        <p className="mt-2 font-semibold text-white">
          {metrics.roofArea.toFixed(1)} sq m gross area
        </p>
        <p className="mt-1 text-slate-400">
          {metrics.usableArea.toFixed(1)} sq m usable
        </p>
      </div>

      <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-3">
        <HudCard label="Usable roof area" value={`${metrics.usableArea.toFixed(1)} sq m`} />
        <HudCard label="Estimated monthly savings" value={`$${metrics.monthlySavings.toLocaleString()}`} />
        <HudCard label="Recommended segment" value={metrics.recommendedSegment?.label ?? "Primary"} />
      </div>
    </div>
  );
}

function AnnualFluxCanvasOverlay({
  annualFluxUrl,
  viewMode,
}: {
  annualFluxUrl: string | null;
  viewMode: ViewMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;

    if (!canvas || !annualFluxUrl || (viewMode !== "overview" && viewMode !== "irradiance")) {
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      return undefined;
    }

    const drawHeatmap = async () => {
      const response = await fetch(annualFluxUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load annual flux heatmap.");
      }

      const arrayBuffer = await response.arrayBuffer();
      const { fromArrayBuffer } = await import("geotiff");
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      const width = image.getWidth();
      const height = image.getHeight();
      const raster = (await image.readRasters({ interleave: true })) as
        | Float32Array
        | Float64Array
        | Uint8Array
        | Uint16Array
        | Uint32Array
        | Int8Array
        | Int16Array
        | Int32Array;

      const validValues = Array.from(raster).filter(
        (value) => Number.isFinite(value) && value > -9990
      ) as number[];

      if (!validValues.length || cancelled) {
        return;
      }

      validValues.sort((left, right) => left - right);
      const low = percentile(validValues, 0.08);
      const high = percentile(validValues, 0.92);
      const range = Math.max(high - low, 1);

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const imageData = context.createImageData(width, height);
      const pixels = imageData.data;

      for (let index = 0; index < raster.length; index += 1) {
        const value = raster[index];
        const offset = index * 4;

        if (!Number.isFinite(value) || value <= -9990) {
          pixels[offset + 3] = 0;
          continue;
        }

        const normalized = clamp01((value - low) / range);
        const { r, g, b } = fluxColor(normalized);
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = 153;
      }

      if (!cancelled) {
        context.putImageData(imageData, 0, 0);
      }
    };

    void drawHeatmap().catch(() => {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
    });

    return () => {
      cancelled = true;
    };
  }, [annualFluxUrl, viewMode]);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full pointer-events-none" />;
}

function PanelSelectionSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const safeMax = Math.max(1, max);

  return (
    <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_10px_28px_rgba(2,8,20,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
            Panel selection
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Choose how many panels to include in the live layout and estimate.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-white">
          {Math.min(value, safeMax)} / {safeMax}
        </div>
      </div>
      <input
        type="range"
        min={1}
        max={safeMax}
        value={Math.min(value, safeMax)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-4 w-full accent-cyan-300"
      />
      <div className="mt-2 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">
        <span>1 panel</span>
        <span>{safeMax} panels</span>
      </div>
    </div>
  );
}

function PanelMapPreview({
  address,
  lat,
  lng,
  roofData,
  selectedPanels,
}: {
  address: string;
  lat: number;
  lng: number;
  roofData: RoofAnalysis;
  selectedPanels: RoofAnalysis["solarPanels"];
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapsMap | null>(null);
  const overlayRef = useRef<SolarPanelOverlay | null>(null);
  const selectedPanelsRef = useRef(selectedPanels);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      if (!mapRef.current || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }

      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setMapError("Google Maps key is not configured.");
        return;
      }

      const googleMaps = await loadGoogleMaps(apiKey);
      if (cancelled || !mapRef.current) {
        return;
      }

      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new googleMaps.Map(mapRef.current, {
          center: { lat, lng },
          zoom: 20,
          mapTypeId: "satellite",
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "none",
          keyboardShortcuts: false,
          scrollwheel: false,
          tilt: 0,
        });
      } else {
        mapInstanceRef.current.setCenter({ lat, lng });
      }

      overlayRef.current?.setMap(null);
      overlayRef.current = new SolarPanelOverlay(mapInstanceRef.current, {
        googleMaps,
        panels: selectedPanelsRef.current,
        roofSegments: roofData.roofSegments,
        panelWidthMeters: roofData.panelWidthMeters,
        panelHeightMeters: roofData.panelHeightMeters,
      });

      setMapReady(true);
      setMapError(null);
    }

    void initializeMap().catch((error) => {
      setMapReady(false);
      setMapError(
        error instanceof Error ? error.message : "Could not load Google Maps."
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    address,
    lat,
    lng,
    roofData.panelHeightMeters,
    roofData.panelWidthMeters,
    roofData.roofSegments,
  ]);

  useEffect(() => {
    selectedPanelsRef.current = selectedPanels;
    overlayRef.current?.setPanels(selectedPanels);
  }, [selectedPanels]);

  useEffect(
    () => () => {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      mapInstanceRef.current = null;
    },
    []
  );

  return (
    <div className="mt-4 rounded-[1.45rem] border border-white/10 bg-black/20 p-4 shadow-[0_10px_28px_rgba(2,8,20,0.18)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
            Panel map
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Selected panels rendered on Google Maps satellite imagery.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-300">
          {mapReady ? "Live" : "Loading"}
        </div>
      </div>
      <div className="relative mt-4 h-52 overflow-hidden rounded-[1.1rem] border border-white/10 bg-slate-950">
          <div ref={mapRef} className="absolute inset-0" />
        {!mapReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 px-4 text-center text-sm text-slate-300">
            {mapError ?? "Loading Google satellite map..."}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-6 text-slate-400">
        The selected {selectedPanels.length} panels are drawn as live map overlays at the property center.
      </p>
    </div>
  );
}

function loadGoogleMaps(apiKey: string) {
  const globalWindow = window as Window & {
    __azGoogleMapsPromise?: Promise<GoogleMapsNamespace>;
    google?: { maps?: GoogleMapsNamespace };
  };

  if (globalWindow.google?.maps) {
    return Promise.resolve(globalWindow.google.maps);
  }

  if (!globalWindow.__azGoogleMapsPromise) {
    globalWindow.__azGoogleMapsPromise = new Promise((resolve, reject) => {
      const scriptId = "az-google-maps-js";
      const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

      if (existing) {
        existing.addEventListener("load", () => resolve(globalWindow.google!.maps!), {
          once: true,
        });
        existing.addEventListener("error", () => reject(new Error("Could not load Google Maps.")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&v=weekly&libraries=maps`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(globalWindow.google!.maps!);
      script.onerror = () => reject(new Error("Could not load Google Maps."));
      document.head.appendChild(script);
    });
  }

  return globalWindow.__azGoogleMapsPromise;
}

class SolarPanelOverlay {
  private container: HTMLDivElement | null = null;
  private map: GoogleMapsMap;
  private panels: RoofAnalysis["solarPanels"];
  private roofSegments: RoofAnalysis["roofSegments"];
  private panelWidthMeters: number;
  private panelHeightMeters: number;
  private overlayView: GoogleMapsOverlayView;

  constructor(
    map: GoogleMapsMap,
    params: {
      googleMaps: GoogleMapsNamespace;
      panels: RoofAnalysis["solarPanels"];
      roofSegments: RoofAnalysis["roofSegments"];
      panelWidthMeters: number;
      panelHeightMeters: number;
    }
  ) {
    this.map = map;
    this.panels = params.panels;
    this.roofSegments = params.roofSegments;
    this.panelWidthMeters = params.panelWidthMeters;
    this.panelHeightMeters = params.panelHeightMeters;
    this.overlayView = new params.googleMaps.OverlayView();
    this.overlayView.onAdd = () => this.onAdd();
    this.overlayView.draw = () => this.draw();
    this.overlayView.onRemove = () => this.onRemove();
    this.overlayView.setMap(map);
  }

  setPanels(panels: RoofAnalysis["solarPanels"]) {
    this.panels = panels;
    this.draw();
  }

  setMap(map: GoogleMapsMap | null) {
    this.overlayView.setMap(map);
  }

  private getPanes() {
    return this.overlayView.getPanes?.();
  }

  private getProjection() {
    return this.overlayView.getProjection?.();
  }

  private onAdd() {
    const panes = this.getPanes();
    if (!panes) {
      return;
    }

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "2";
    this.container = container;
    panes.overlayLayer.appendChild(container);
  }

  private draw() {
    const container = this.container;
    if (!container) {
      return;
    }

    const projection = this.getProjection();
    if (!projection) {
      return;
    }

    container.innerHTML = "";

    this.panels.forEach((panel, index) => {
      const segment = this.roofSegments[panel.segmentIndex] ?? this.roofSegments[0];
      const projected = projection.fromLatLngToDivPixel(panel.center);

      if (!projected) {
        return;
      }

      const widthMeters =
        panel.orientation === "LANDSCAPE"
          ? this.panelHeightMeters
          : this.panelWidthMeters;
      const heightMeters =
        panel.orientation === "LANDSCAPE"
          ? this.panelWidthMeters
          : this.panelHeightMeters;
      const east = projection.fromLatLngToDivPixel(
        metersOffset(panel.center.lat, panel.center.lng, 0, widthMeters / 2)
      );
      const west = projection.fromLatLngToDivPixel(
        metersOffset(panel.center.lat, panel.center.lng, 0, -widthMeters / 2)
      );
      const north = projection.fromLatLngToDivPixel(
        metersOffset(panel.center.lat, panel.center.lng, heightMeters / 2, 0)
      );
      const south = projection.fromLatLngToDivPixel(
        metersOffset(panel.center.lat, panel.center.lng, -heightMeters / 2, 0)
      );

      const pixelWidth = Math.max(5, Math.abs((east?.x ?? 0) - (west?.x ?? 0)));
      const pixelHeight = Math.max(8, Math.abs((south?.y ?? 0) - (north?.y ?? 0)));
      const rotation =
        panel.orientation === "LANDSCAPE"
          ? 180 - (segment?.azimuthDeg ?? 180)
          : 90 - (segment?.azimuthDeg ?? 180);

      const element = document.createElement("div");
      element.style.position = "absolute";
      element.style.left = `${projected.x - pixelWidth / 2}px`;
      element.style.top = `${projected.y - pixelHeight / 2}px`;
      element.style.width = `${pixelWidth}px`;
      element.style.height = `${pixelHeight}px`;
      element.style.borderRadius = "2px";
      element.style.background = index < this.panels.length ? "rgba(37, 99, 235, 0.72)" : "rgba(37, 99, 235, 0.36)";
      element.style.border = "1px solid rgba(255, 255, 255, 0.65)";
      element.style.boxShadow = "0 0 0 1px rgba(15, 23, 42, 0.24) inset";
      element.style.transformOrigin = "center center";
      element.style.transform = `rotate(${rotation}deg)`;
      container.appendChild(element);
    });
  }

  private onRemove() {
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}

function metersOffset(lat: number, lng: number, northMeters: number, eastMeters: number) {
  const earthRadius = 6378137;
  const dLat = (northMeters / earthRadius) * (180 / Math.PI);
  const dLng =
    (eastMeters / (earthRadius * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);

  return {
    lat: lat + dLat,
    lng: lng + dLng,
  };
}

function fluxColor(value: number) {
  const blue = { r: 37, g: 99, b: 235 };
  const yellow = { r: 250, g: 204, b: 21 };
  const red = { r: 239, g: 68, b: 68 };

  if (value <= 0.5) {
    return blendColor(blue, yellow, value / 0.5);
  }

  return blendColor(yellow, red, (value - 0.5) / 0.5);
}

function blendColor(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  amount: number
) {
  const t = clamp01(amount);

  return {
    r: Math.round(left.r + (right.r - left.r) * t),
    g: Math.round(left.g + (right.g - left.g) * t),
    b: Math.round(left.b + (right.b - left.b) * t),
  };
}

function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.round((values.length - 1) * clamp01(ratio)))
  );

  return values[index] ?? 0;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function MeasurementPanel({
  roofData,
  metrics,
}: {
  roofData: RoofAnalysis;
  metrics: AnalysisMetrics;
}) {
  return (
    <div className="rounded-[1.45rem] border border-white/10 bg-black/16 p-4">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
        Measurements
      </p>
      <div className="mt-4 grid gap-3">
        <MetricRow label="Roof width" value={`${roofData.widthM.toFixed(1)} m`} />
        <MetricRow label="Roof depth" value={`${roofData.depthM.toFixed(1)} m`} />
        <MetricRow label="Gross roof area" value={`${metrics.roofArea.toFixed(1)} sq m`} />
        <MetricRow label="Usable roof area" value={`${metrics.usableArea.toFixed(1)} sq m`} />
        <MetricRow label="Average roof pitch" value={`${roofData.pitchDeg.toFixed(1)} deg`} />
        <MetricRow label="Primary orientation" value={metrics.orientationLabel} />
      </div>
      <div className="mt-4 rounded-[1rem] border border-white/8 bg-white/[0.03] p-3">
        <p className="text-[0.56rem] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Segment allocation
        </p>
        <div className="mt-3 space-y-2">
          {roofData.roofSegments.slice(0, 3).map((segment) => (
            <div key={segment.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="capitalize text-slate-300">{segment.label}</span>
              <span className="text-slate-400">{segment.areaM2.toFixed(1)} sq m</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendPanel({
  roofData,
  metrics,
}: {
  roofData: RoofAnalysis;
  metrics: AnalysisMetrics;
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
      <div className="rounded-[1.15rem] border border-white/8 bg-slate-950/42 p-3 text-xs leading-6 text-slate-400">
        Estimates are based on rooftop image interpretation, standard 400W modules, and a $0.13/kWh Arizona utility rate.
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
          className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_30px_rgba(2,8,20,0.22)] backdrop-blur-xl"
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
      className={`rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_30px_rgba(2,8,20,0.22)] backdrop-blur-xl ${className}`.trim()}
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
    <article className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_28px_rgba(2,8,20,0.2)] backdrop-blur-xl transition hover:bg-white/[0.05]">
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
    <div className="rounded-[1.55rem] border border-white/10 bg-white/[0.05] p-4 shadow-[0_10px_28px_rgba(2,8,20,0.2)] backdrop-blur-xl">
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
    <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/72 px-3 py-3 shadow-[0_10px_24px_rgba(2,8,20,0.18)] backdrop-blur-xl">
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
      className={`rounded-full border px-3 py-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.26em] backdrop-blur-md ${toneClass}`.trim()}
    >
      {label}
    </span>
  );
}

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

async function resolveProperty(
  address: string,
  signal: AbortSignal
): Promise<ResolvedProperty> {
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

function getBounds(points: Point[]): Bounds {
  return points.reduce(
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
}

function buildMeasurementLines(
  outline: Point[],
  bounds: Bounds,
  roofData: RoofAnalysis
): MeasurementLine[] {
  const topY = Math.max(8, bounds.minY - 5.4);
  const rightX = Math.min(94, bounds.maxX + 4.8);
  const topPoints = [...outline].sort((left, right) => left.y - right.y).slice(0, 2);
  const rightPoints = [...outline].sort((left, right) => right.x - left.x).slice(0, 2);
  const topLeft = topPoints.sort((left, right) => left.x - right.x)[0] ?? { x: bounds.minX, y: bounds.minY };
  const topRight =
    topPoints.sort((left, right) => right.x - left.x)[0] ?? { x: bounds.maxX, y: bounds.minY };
  const rightTop = rightPoints.sort((left, right) => left.y - right.y)[0] ?? { x: bounds.maxX, y: bounds.minY };
  const rightBottom =
    rightPoints.sort((left, right) => right.y - left.y)[0] ?? { x: bounds.maxX, y: bounds.maxY };

  return [
    {
      id: "width",
      x1: topLeft.x,
      y1: topY,
      x2: topRight.x,
      y2: topY,
      labelX: (topLeft.x + topRight.x) / 2,
      labelY: topY - 2.3,
      label: `${roofData.widthM.toFixed(1)} m`,
    },
    {
      id: "depth",
      x1: rightX,
      y1: rightTop.y,
      x2: rightX,
      y2: rightBottom.y,
      labelX: rightX + 1.8,
      labelY: (rightTop.y + rightBottom.y) / 2,
      label: `${roofData.depthM.toFixed(1)} m`,
    },
  ];
}

function buildPanelLayout(analysis: RoofAnalysis, polygon: Point[]): PanelRect[] {
  const usableSegments = analysis.roofSegments
    .filter((segment) => segment.usable && segment.outline.length >= 3)
    .sort((left, right) => right.panelsFit - left.panelsFit);

  if (!usableSegments.length || analysis.panelCount <= 0) {
    return [];
  }

  const panels: PanelRect[] = [];
  let placedPanels = 0;

  usableSegments.forEach((segment, segmentIndex) => {
    const segmentBounds = getBounds(segment.outline);
    const segmentWidth = Math.max(segmentBounds.maxX - segmentBounds.minX - 3.2, 8);
    const segmentHeight = Math.max(segmentBounds.maxY - segmentBounds.minY - 3, 6);
    const targetPanels = Math.min(
      segment.panelsFit,
      Math.max(0, analysis.panelCount - placedPanels)
    );

    if (targetPanels <= 0) {
      return;
    }

    const columns = Math.max(2, Math.min(6, Math.round(Math.sqrt(targetPanels * 1.2))));
    const rows = Math.max(1, Math.ceil(targetPanels / columns));
    const gap = 0.7;
    const panelWidth = Math.max(
      2.2,
      Math.min(5.2, (segmentWidth - gap * (columns - 1)) / columns)
    );
    const panelHeight = Math.max(
      2.5,
      Math.min(4.4, (segmentHeight - gap * (rows - 1)) / rows)
    );
    const rotation = clampNumber((segment.azimuthDeg - 180) / 10, -18, 18);
    const segmentCenter = getPolygonCenter(segment.outline);
    const localPolygon = toLocalPolygon(segment.outline, segmentCenter, rotation);
    const localBounds = getBounds(localPolygon);
    const startX = localBounds.minX + panelWidth / 2 + 0.8;
    const startY = localBounds.minY + panelHeight / 2 + 0.8;
    let segmentPlaced = 0;

    for (let index = 0; index < targetPanels * 3 && segmentPlaced < targetPanels; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const localX = startX + column * (panelWidth + gap);
      const localY = startY + row * (panelHeight + gap * 0.9);
      const worldPosition = fromLocalPoint(
        { x: localX, y: localY },
        segmentCenter,
        rotation
      );
      const panel = {
        id: `panel-${segment.label}-${segmentIndex}-${segmentPlaced}`,
        x: worldPosition.x - panelWidth / 2,
        y: worldPosition.y - panelHeight / 2,
        width: panelWidth,
        height: panelHeight,
        rotation,
      };

      if (!panelFitsOutline(panel, segment.outline)) {
        continue;
      }

      panels.push({
        ...panel,
      });
      segmentPlaced += 1;
    }

    placedPanels += segmentPlaced;
  });

  if (panels.length > 0) {
    return panels;
  }

  const bounds = getBounds(polygon);
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

function pointsToString(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function panelFitsOutline(panel: PanelRect, outline: Point[]) {
  const corners = getRotatedPanelCorners(panel);

  return corners.every((corner) => pointInPolygon(corner, outline));
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || 0.00001) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function getPolygonCenter(points: Point[]) {
  return points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x / points.length,
      y: accumulator.y + point.y / points.length,
    }),
    { x: 0, y: 0 }
  );
}

function getRotatedPanelCorners(panel: PanelRect) {
  const center = {
    x: panel.x + panel.width / 2,
    y: panel.y + panel.height / 2,
  };
  const localCorners = [
    { x: -panel.width / 2, y: -panel.height / 2 },
    { x: panel.width / 2, y: -panel.height / 2 },
    { x: panel.width / 2, y: panel.height / 2 },
    { x: -panel.width / 2, y: panel.height / 2 },
  ];

  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, panel.rotation);
    return {
      x: center.x + rotated.x,
      y: center.y + rotated.y,
    };
  });
}

function rotatePoint(point: Point, rotationDeg: number) {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function toLocalPolygon(points: Point[], center: Point, rotationDeg: number) {
  return points.map((point) =>
    rotatePoint(
      {
        x: point.x - center.x,
        y: point.y - center.y,
      },
      -rotationDeg
    )
  );
}

function fromLocalPoint(point: Point, center: Point, rotationDeg: number) {
  const rotated = rotatePoint(point, rotationDeg);
  return {
    x: rotated.x + center.x,
    y: rotated.y + center.y,
  };
}

function formatAzimuth(value: number) {
  const normalized = ((value % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return azimuthLabels[index];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
