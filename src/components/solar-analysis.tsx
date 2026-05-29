"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import {
  getRoofAreaM2,
  getUsableAreaM2,
  type RoofGeoBounds,
  type RoofAnalysis,
} from "@/lib/roof-analysis";

type ResolvedProperty = {
  address: string;
  lat: number;
  lng: number;
};

type SolarAnalysisProps = {
  address: string;
  compact?: boolean;
  location?: {
    lat?: number;
    lng?: number;
  } | null;
  activePanelCount?: number | null;
  onAnalysisChange?: (analysis: RoofAnalysis | null) => void;
  onActivePanelCountChange?: (panelCount: number) => void;
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
  bounds?: RoofGeoBounds | null;
  message?: string;
};

type SolarDataLayersPayload = {
  annualFluxUrl?: string | null;
  dsmUrl?: string | null;
  maskUrl?: string | null;
  rgbUrl?: string | null;
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

type AnalysisMetrics = {
  roofArea: number;
  usableArea: number;
  averageRoofPitch: number;
  annualSunlightHours: number;
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

type RasterData =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

type LatLngPoint = {
  lat: number;
  lng: number;
};

type DsmPlaneExtraction = {
  bounds: RoofGeoBounds;
  planes: Array<{
    aspectDeg: number;
    confidence: number;
    path: LatLngPoint[];
    slopeDeg: number;
  }>;
};

type GoogleMapsWindow = Window &
  typeof globalThis & {
    google?: GoogleMapsApi;
    __solarMapsPromise?: Promise<GoogleMapsApi>;
  };

type GoogleMapsApi = {
  maps: {
    Map: new (
      element: HTMLElement,
      options: Record<string, unknown>
    ) => GoogleMapInstance;
    LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
    Rectangle: new (
      options: Record<string, unknown>
    ) => GoogleMapOverlayInstance;
    Polygon: new (
      options: Record<string, unknown>
    ) => GoogleMapOverlayInstance;
    OverlayView: new () => GoogleOverlayViewInstance;
    MapTypeId: {
      SATELLITE: string;
    };
  };
};

type GoogleMapInstance = {
  fitBounds?: (
    bounds: { north: number; south: number; east: number; west: number },
    padding?: number
  ) => void;
  getZoom?: () => number | undefined;
  setCenter: (latLng: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  setMapTypeId: (mapTypeId: string) => void;
  setTilt: (tilt: number) => void;
};

type GoogleLatLngInstance = unknown;

type GoogleMapOverlayInstance = {
  setMap: (map: GoogleMapInstance | null) => void;
};

type GoogleOverlayViewInstance = GoogleMapOverlayInstance & {
  onAdd: () => void;
  draw: () => void;
  onRemove: () => void;
  getPanes: () => { overlayLayer?: HTMLElement } | null;
  getProjection: () => {
    fromLatLngToDivPixel: (latLng: GoogleLatLngInstance) => {
      x: number;
      y: number;
    } | null;
  };
};

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "panels", label: "Panels" },
  { id: "irradiance", label: "Irradiance" },
];

const dsmPlaneExtractionCache = new Map<string, Promise<DsmPlaneExtraction | null>>();
const PANEL_MODULE_GAP_METERS = 0.2032;
const PANEL_COLLISION_EPSILON_METERS = 0.01;

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
  activePanelCount,
  compact = false,
  location,
  onAnalysisChange,
  onActivePanelCountChange,
}: SolarAnalysisProps) {
  const [stage, setStage] = useState<
    "idle" | "resolving" | "fetching" | "analyzing" | "done" | "invalid" | "error"
  >("idle");
  const [satelliteImage, setSatelliteImage] = useState<string | null>(null);
  const [annualFluxUrl, setAnnualFluxUrl] = useState<string | null>(null);
  const [dsmUrl, setDsmUrl] = useState<string | null>(null);
  const [solarMaskUrl, setSolarMaskUrl] = useState<string | null>(null);
  const [roofData, setRoofData] = useState<RoofAnalysis | null>(null);
  const [resolvedProperty, setResolvedProperty] =
    useState<ResolvedProperty | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [internalPanelCount, setInternalPanelCount] = useState<number>(0);
  const selectedPanelCount = activePanelCount ?? internalPanelCount;
  const setSelectedPanelCount = useCallback(
    (nextPanelCount: number) => {
      setInternalPanelCount(nextPanelCount);
      onActivePanelCountChange?.(nextPanelCount);
    },
    [onActivePanelCountChange]
  );

  useEffect(() => {
    const trimmedAddress = address.trim();

    if (!trimmedAddress) {
      const resetHandle = window.requestAnimationFrame(() => {
        setStage("idle");
        setSatelliteImage(null);
        setAnnualFluxUrl(null);
        setDsmUrl(null);
        setSolarMaskUrl(null);
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
        setDsmUrl(null);
        setSolarMaskUrl(null);
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
          setDsmUrl(dataLayersPayload.dsmUrl ?? null);
          setSolarMaskUrl(dataLayersPayload.maskUrl ?? null);
        } else {
          setAnnualFluxUrl(null);
          setDsmUrl(null);
          setSolarMaskUrl(null);
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

        const panelSyncedRoofData = buildAcceptedPanelAnalysis(nextRoofData);
        setRoofData(panelSyncedRoofData);
        setSelectedPanelCount(
          Math.max(
            1,
            Math.min(
              getMaxSelectablePanelCount(panelSyncedRoofData),
              panelSyncedRoofData.solarPanels.length || panelSyncedRoofData.panelCount
            )
          )
        );
        onAnalysisChange?.(panelSyncedRoofData);
        setStage("done");
        setNotice(
          panelSyncedRoofData.confidence !== "high" ? panelSyncedRoofData.confidenceNote : null
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
  }, [address, location, onAnalysisChange, setSelectedPanelCount]);

  const selectedPanels = useMemo(() => {
    if (!roofData) {
      return [];
    }

    const maxSelectablePanels = getMaxSelectablePanelCount(roofData);
    const count = clampNumber(selectedPanelCount || maxSelectablePanels, 1, maxSelectablePanels);

    return roofData.solarPanels.slice(0, count);
  }, [roofData, selectedPanelCount]);

  const metrics = useMemo(() => {
    if (!roofData) {
      return null;
    }

    const roofArea = getRoofAreaM2(roofData);
    const usableArea = getUsableAreaM2(roofData);
    const averageRoofPitch =
      roofData.roofSegments.length > 0
        ? Math.round(
            (roofData.roofSegments.reduce(
              (sum, segment) => sum + Math.max(segment.pitchDeg, 0),
              0
            ) / roofData.roofSegments.length) * 10
          ) / 10
        : roofData.pitchDeg;
    const panelCapacityWatts = roofData.panelCapacityWatts || 400;
    const livePanelCount = clampNumber(
      selectedPanelCount || getMaxSelectablePanelCount(roofData),
      1,
      getMaxSelectablePanelCount(roofData)
    );
    const selectedConfig = findNearestPanelConfig(
      roofData.solarPanelConfigs,
      livePanelCount
    );
    const totalAnnualKwh = roofData.annualKwh;
    const perPanelKwh =
      roofData.panelCount > 0
        ? totalAnnualKwh / Math.max(roofData.panelCount, 1)
        : 0;
    const selectedAnnualKwh = Math.max(
      0,
      Math.round(
        selectedConfig?.yearlyEnergyDcKwh ??
          (selectedPanels.length > 0
            ? selectedPanels.reduce(
                (sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0),
                0
              )
            : perPanelKwh * livePanelCount)
      )
    );
    const selectedAnnualSavingsUSD = Math.round(selectedAnnualKwh * 0.13);
    const selectedSystemKw = Math.round(((livePanelCount * panelCapacityWatts) / 1000) * 10) / 10;
    const monthlySavings = Math.round(selectedAnnualSavingsUSD / 12);
    const estimatedNetCost = livePanelCount * panelCapacityWatts * 2.75;
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
      averageRoofPitch,
      annualSunlightHours: roofData.annualSunlightHours,
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
        ? { label: "Analyzing roof with satellite data...", pct: 38 }
        : stage === "analyzing"
          ? { label: "Analyzing roof with satellite data...", pct: 76 }
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
            <MetricRow
              label="Confidence"
              value={`${roofData?.confidence ?? "low"}${roofData ? ` (${roofData.rooftopConfidenceScore}/100)` : ""}`}
            />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-400">
            Try a detached house address with a clearly visible rooftop in the satellite image.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={compact ? "space-y-3" : "space-y-6"}>
      {stageStep ? (
        <AnalysisProgress step={stageStep.label} pct={stageStep.pct} />
      ) : null}

      {satelliteImage && stage !== "done" ? (
        <div className={compact ? "grid gap-4" : "grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_22rem]"}>
          <div className="overflow-hidden rounded-[1.85rem] border border-white/10 bg-slate-950/76 shadow-[0_12px_42px_rgba(2,8,20,0.36)]">
            <ViewportHeader
              address={resolvedProperty?.address ?? address}
              viewMode={viewMode}
              onSelectView={setViewMode}
            />
            <div className={compact ? "relative min-h-[24rem]" : "relative min-h-[30rem]"}>
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
                    Analyzing roof with satellite data...
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Waiting for Google Solar API roof geometry, panel coordinates, and annual flux layers.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {compact ? null : <AnalysisSidebarSkeleton />}
        </div>
      ) : null}

      {stage === "done" && roofData && metrics ? (
        compact ? (
          <article className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/82 shadow-[0_14px_44px_rgba(2,8,20,0.36)]">
            <ViewportHeader
              address={resolvedProperty?.address ?? address}
              viewMode={viewMode}
              onSelectView={setViewMode}
            />
            <div className="border-t border-white/8 p-3">
              <div className="relative overflow-hidden rounded-[1.1rem] border border-white/8">
                <ViewportCanvas
                  satelliteImage={satelliteImage}
                  annualFluxUrl={annualFluxUrl}
                  dsmUrl={dsmUrl}
                  solarMaskUrl={solarMaskUrl}
                  address={resolvedProperty?.address ?? address}
                  compact
                  property={resolvedProperty}
                  roofData={roofData}
                  viewMode={viewMode}
                  selectedPanelCount={metrics.selectedPanelCount}
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <CompactMapStat
                  label="Panel layout"
                  source="Solar API"
                  value={`${metrics.selectedPanelCount} modules`}
                />
                <CompactMapStat
                  label="System size"
                  source="User-adjusted"
                  value={`${metrics.selectedSystemKw.toFixed(1)} kW`}
                />
                <CompactMapStat
                  label="Orientation"
                  source="Solar API"
                  value={metrics.orientationLabel}
                />
              </div>
              <div className="mt-3 rounded-[1rem] border border-white/8 bg-white/[0.035] p-3 text-xs leading-5 text-slate-300">
                <p>
                  Panels are placed from available Solar API candidate points and adjusted
                  for visual spacing, estimated setbacks, and overlap prevention.
                </p>
                <p className="mt-2 text-slate-400">
                  Panels are prioritized on roof planes with stronger sunlight, cleaner
                  geometry, and fewer placement conflicts.
                </p>
                {roofData.rejectedPanelCandidateCount ? (
                  <p className="mt-2 text-amber-100">
                    {roofData.rejectedPanelCandidateCount} candidate panels were not placed
                    due to spacing or setback limits.
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <article className="overflow-hidden rounded-[1.95rem] border border-white/10 bg-slate-950/82 shadow-[0_14px_44px_rgba(2,8,20,0.36)]">
              <ViewportHeader
                address={resolvedProperty?.address ?? address}
                viewMode={viewMode}
                onSelectView={setViewMode}
              />
              <div className="border-t border-white/8 p-4 sm:p-5">
                <div className="relative overflow-hidden rounded-[1.7rem] border border-white/8">
                  <ViewportCanvas
                    satelliteImage={satelliteImage}
                    annualFluxUrl={annualFluxUrl}
                    dsmUrl={dsmUrl}
                    solarMaskUrl={solarMaskUrl}
                    address={resolvedProperty?.address ?? address}
                    property={resolvedProperty}
                    roofData={roofData}
                    viewMode={viewMode}
                    selectedPanelCount={metrics.selectedPanelCount}
                  />
                </div>
              </div>
            </article>

            <aside className="space-y-4">
              <SunroofSummaryCard
                address={resolvedProperty?.address ?? address}
                metrics={metrics}
                confidence={roofData.rooftopConfidenceScore}
              />

              <SidebarPanel>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                  Analysis status
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                  Preliminary roof model ready
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Roof geometry and usable solar area are tied to the Google Solar building record returned for this property. Final design requires installer confirmation.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill label={`${roofData.confidence} confidence`} tone="cyan" />
                  <Pill label={`${roofData.rooftopConfidenceScore}/100 rooftop score`} />
                  <Pill label={`${metrics.orientationLabel} orientation`} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  {notice ?? roofData.confidenceNote}
                </p>
              </SidebarPanel>

              <PanelSelectionSlider
                value={metrics.selectedPanelCount}
                max={Math.max(1, roofData.panelCount)}
                onChange={setSelectedPanelCount}
                canRenderPanels={roofData.solarPanels.length > 0}
              />
              <RoofStatsPanel roofData={roofData} metrics={metrics} />
              <FinancialSnapshot metrics={metrics} />
              <SegmentationPanel roofData={roofData} />

              <SidebarPanel className="bg-[linear-gradient(180deg,rgba(103,232,249,0.08),rgba(255,255,255,0.02))]">
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                  Next step
                </p>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
                  Turn this preliminary model into a confirmed proposal.
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Save the roof geometry, accepted panel count, and modeled economics into a preliminary estimate for installer review.
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

          <section className="grid gap-4 lg:grid-cols-3">
            <IntelligenceCard
              eyebrow="Site findings"
              title="Rooftop analysis summary"
              body={`The primary roof plane faces ${metrics.orientationLabel} with ${metrics.selectedPanelCount} accepted modules across usable roof surfaces. The current model marks ${roofData.usablePctRoof}% of the roof as solar-ready with ${roofData.shadingRisk} shading exposure.`}
            />
            <IntelligenceCard
              eyebrow="Environmental impact"
              title={`${metrics.carbonOffsetTons.toFixed(1)} tons of annual carbon avoided`}
              body={`That is roughly ${metrics.treesEquivalent} mature trees worth of yearly carbon offset, driven by an estimated ${metrics.selectedAnnualKwh.toLocaleString()} kWh of annual solar production.`}
            />
            <IntelligenceCard
              eyebrow="Install strategy"
              title="Recommended installation approach"
              body={`Prioritize the ${metrics.recommendedSegment?.label ?? "primary"} roof segment first, hold lower-performing planes for optional expansion, and keep conduit routing tight to reduce visible clutter on the front elevation.`}
            />
          </section>
        </div>
        )
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
            Roof measurements, annual flux, and accepted panel candidates are projected from the current Solar API building model onto the rooftop image.
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
            onClick={() =>
              onSelectView(
                viewMode === mode.id && mode.id !== "overview"
                  ? "overview"
                  : mode.id
              )
            }
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
  dsmUrl,
  solarMaskUrl,
  address,
  compact = false,
  property,
  roofData,
  viewMode,
  selectedPanelCount,
}: {
  satelliteImage: string | null;
  annualFluxUrl: string | null;
  dsmUrl: string | null;
  solarMaskUrl: string | null;
  address: string;
  compact?: boolean;
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
  viewMode: ViewMode;
  selectedPanelCount: number;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlayRefs = useRef<GoogleMapOverlayInstance[]>([]);
  const overlayRunRef = useRef(0);
  const cameraFitTimeoutRef = useRef<number | null>(null);
  const cameraFitKeyRef = useRef<string | null>(null);
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const cameraTarget = useMemo(
    () => buildRoofMapFitTarget({ property, roofData }),
    [property, roofData]
  );
  const cameraTargetKey = useMemo(
    () => getRoofMapFitTargetKey(cameraTarget),
    [cameraTarget]
  );
  const center = cameraTarget.center ?? property;

  useEffect(() => {
    let cancelled = false;

    const setupMap = async () => {
      if (!mapElementRef.current || !center || !mapsApiKey) {
        return;
      }

      const googleApi = await loadGoogleMapsApi(mapsApiKey);
      if (cancelled || !mapElementRef.current) {
        return;
      }

      if (!mapRef.current) {
        mapRef.current = new googleApi.maps.Map(mapElementRef.current, {
          center,
          zoom: 19,
          tilt: 0,
          mapTypeId: googleApi.maps.MapTypeId.SATELLITE,
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          gestureHandling: "greedy",
        });
      }

      if (cameraFitTimeoutRef.current !== null) {
        window.clearTimeout(cameraFitTimeoutRef.current);
        cameraFitTimeoutRef.current = null;
      }

      cameraFitTimeoutRef.current = fitMapToRoofTarget({
        map: mapRef.current,
        padding: getMapFitPadding(mapElementRef.current),
        target: cameraTarget,
      });
      cameraFitKeyRef.current = cameraTargetKey;
      mapRef.current.setTilt(0);
      mapRef.current.setMapTypeId(googleApi.maps.MapTypeId.SATELLITE);
    };

    void setupMap();

    return () => {
      cancelled = true;
      if (cameraFitTimeoutRef.current !== null) {
        window.clearTimeout(cameraFitTimeoutRef.current);
        cameraFitTimeoutRef.current = null;
      }
    };
  }, [cameraTarget, cameraTargetKey, center, mapsApiKey]);

  useEffect(() => {
    let cancelled = false;

    const drawOverlays = async () => {
      if (!mapRef.current || !mapsApiKey) {
        return;
      }

      const googleApi = await loadGoogleMapsApi(mapsApiKey);
      if (cancelled || !mapRef.current) {
        return;
      }

      const overlayRun = overlayRunRef.current + 1;
      overlayRunRef.current = overlayRun;
      clearGoogleOverlays(overlayRefs.current);
      overlayRefs.current = [];

      const nextOverlays: GoogleMapOverlayInstance[] = [];
      const dsmExtraction = await getDsmPlaneExtraction({
        dsmUrl,
        fallbackBounds: roofData.roofBounds,
        maskUrl: solarMaskUrl,
      });
      if (cancelled || overlayRunRef.current !== overlayRun || !mapRef.current) {
        return;
      }

      const boundsOverlay = createRoofBoundsOverlay(
        googleApi,
        roofData.roofBounds,
        mapRef.current
      );
      if (boundsOverlay) {
        nextOverlays.push(boundsOverlay);
      }

      const footprintOverlay = createRoofFootprintOverlay({
        googleApi,
        map: mapRef.current,
        roofData,
      });
      if (footprintOverlay) {
        nextOverlays.push(footprintOverlay);
      }

      const dsmPlaneOverlays = dsmExtraction?.planes.length
        ? createDsmPlaneOverlays({
            extraction: dsmExtraction,
            googleApi,
            map: mapRef.current,
          })
        : [];

      nextOverlays.push(
        ...(dsmPlaneOverlays.length
          ? dsmPlaneOverlays
          : createRoofSegmentOverlays({
              googleApi,
              map: mapRef.current,
              roofData,
            }))
      );
      const setbackOverlay = createSetbackOverlay({
        googleApi,
        map: mapRef.current,
        roofData,
      });
      if (setbackOverlay) {
        nextOverlays.push(setbackOverlay);
      }
      nextOverlays.push(
        ...createObstructionOverlays({
          googleApi,
          map: mapRef.current,
          roofData,
        })
      );
      overlayRefs.current = nextOverlays;

      if (viewMode === "irradiance") {
        const heatmapOverlay = await createAnnualFluxMapOverlay({
          googleApi,
          annualFluxUrl,
          solarMaskUrl,
          fallbackBounds: roofData.roofBounds,
          opacity: 0.68,
        });

        if (heatmapOverlay) {
          if (cancelled || overlayRunRef.current !== overlayRun || !mapRef.current) {
            heatmapOverlay.setMap(null);
            return;
          }

          heatmapOverlay.setMap(mapRef.current);
          nextOverlays.push(heatmapOverlay);
        }
      }

      if (viewMode === "panels") {
        nextOverlays.push(
          ...createPanelMapOverlays({
            googleApi,
            map: mapRef.current,
            roofData,
            selectedPanelCount,
          })
        );
      }

      if (!cancelled && overlayRunRef.current === overlayRun && mapRef.current) {
        overlayRefs.current = nextOverlays;
        if (cameraFitKeyRef.current !== cameraTargetKey) {
          if (cameraFitTimeoutRef.current !== null) {
            window.clearTimeout(cameraFitTimeoutRef.current);
          }

          cameraFitTimeoutRef.current = fitMapToRoofTarget({
            map: mapRef.current,
            padding: getMapFitPadding(mapElementRef.current),
            target: cameraTarget,
          });
          cameraFitKeyRef.current = cameraTargetKey;
        }
      } else {
        clearGoogleOverlays(nextOverlays);
      }
    };

    void drawOverlays();

    return () => {
      cancelled = true;
      overlayRunRef.current += 1;
      clearGoogleOverlays(overlayRefs.current);
      overlayRefs.current = [];
    };
  }, [
    annualFluxUrl,
    dsmUrl,
    mapsApiKey,
    roofData,
    selectedPanelCount,
    solarMaskUrl,
    viewMode,
    property,
    cameraTarget,
    cameraTargetKey,
  ]);

  const showMapFallback = !mapsApiKey;

  return (
    <div className={`relative overflow-hidden bg-slate-950 ${compact ? "min-h-[24rem] lg:min-h-[30rem]" : "min-h-[36rem] lg:min-h-[43rem]"}`}>
      <div ref={mapElementRef} className="absolute inset-0" />
      {showMapFallback && satelliteImage ? (
        <Image
          src={satelliteImage}
          alt={`Satellite view of ${address}`}
          fill
          unoptimized
          className="object-cover"
        />
      ) : null}
      {showMapFallback ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/72 px-6 text-center">
          <p className="max-w-sm text-sm leading-6 text-slate-300">
            Google Maps browser key is missing. Add
            {" "}
            <span className="font-semibold text-white">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</span>
            {" "}
            to render live map overlays.
          </p>
        </div>
      ) : null}
      {!showMapFallback ? (
        <MapEvidenceOverlay roofData={roofData} selectedPanelCount={selectedPanelCount} />
      ) : null}
    </div>
  );
}

function loadGoogleMapsApi(apiKey: string) {
  const browserWindow = window as GoogleMapsWindow;

  if (browserWindow.google?.maps) {
    return Promise.resolve(browserWindow.google);
  }

  if (!browserWindow.__solarMapsPromise) {
    browserWindow.__solarMapsPromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById("google-maps-js");
      const callbackName = "__initSolarGoogleMaps";
      const callbacks = browserWindow as unknown as Record<
        string,
        (() => void) | undefined
      >;

      callbacks[callbackName] = () => {
        if (browserWindow.google?.maps) {
          resolve(browserWindow.google);
        } else {
          reject(new Error("Google Maps failed to initialize."));
        }
      };

      if (existingScript) {
        return;
      }

      const script = document.createElement("script");
      script.id = "google-maps-js";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&callback=${callbackName}`;
      script.onerror = () => reject(new Error("Google Maps script failed to load."));
      document.head.appendChild(script);
    });
  }

  return browserWindow.__solarMapsPromise;
}

function MapEvidenceOverlay({
  roofData,
  selectedPanelCount,
}: {
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}) {
  const placedByPlane = useMemo(
    () => getPlacedPanelCountsByPlane(roofData, selectedPanelCount),
    [roofData, selectedPanelCount]
  );
  const rejectedCount = Math.max(0, roofData.rejectedPanelCandidateCount ?? 0);

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-[0.95rem] border border-white/12 bg-slate-950/78 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_10px_28px_rgba(2,8,20,0.24)] backdrop-blur-md">
        Google Solar API roof model
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-[1rem] border border-white/12 bg-slate-950/82 p-3 text-xs text-slate-200 shadow-[0_14px_34px_rgba(2,8,20,0.28)] backdrop-blur-md">
        <p className="text-[0.58rem] font-semibold uppercase tracking-[0.28em] text-cyan-200">
          Map legend
        </p>
        <div className="mt-2 grid gap-1.5">
          <LegendItem swatch="bg-blue-500" label="Blue: placed panels" />
          <LegendItem swatch="border border-cyan-200 bg-cyan-200/10" label="Cyan: roof plane / usable area" />
          <LegendItem swatch="border border-emerald-200 bg-emerald-200/10" label="Green: estimated setback boundary" />
          <LegendItem swatch="bg-slate-400/45" label="Gray: unavailable or obstructed area" />
        </div>
        <div className="mt-3 grid gap-1 border-t border-white/10 pt-2 text-[0.7rem] leading-5 text-slate-300">
          {placedByPlane.map((item) => (
            <div key={item.label} className="flex justify-between gap-3">
              <span className="capitalize">{item.label} plane</span>
              <span className="font-semibold text-white">{item.count} panels</span>
            </div>
          ))}
          {rejectedCount > 0 ? (
            <div className="flex justify-between gap-3 text-amber-100">
              <span>Not placed</span>
              <span className="font-semibold">{rejectedCount} candidates</span>
            </div>
          ) : null}
        </div>
        <p className="mt-3 border-t border-white/10 pt-2 text-[0.68rem] leading-5 text-slate-400">
          Roof geometry and panel candidates come from Google Solar API. Savings are modeled using Arizona assumptions.
        </p>
      </div>
    </>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${swatch}`} />
      <span>{label}</span>
    </div>
  );
}

function getPlacedPanelCountsByPlane(roofData: RoofAnalysis, selectedPanelCount: number) {
  const panels = roofData.solarPanels.slice(
    0,
    clampNumber(selectedPanelCount, 0, getMaxSelectablePanelCount(roofData))
  );
  const counts = panels.reduce<Map<number, number>>((nextCounts, panel) => {
    nextCounts.set(panel.segmentIndex, (nextCounts.get(panel.segmentIndex) ?? 0) + 1);
    return nextCounts;
  }, new Map());

  return roofData.roofSegments
    .map((segment, index) => ({
      count: counts.get(index) ?? 0,
      label: segment.label,
    }))
    .filter((item) => item.count > 0)
    .slice(0, 3);
}

function clearGoogleOverlays(overlays: GoogleMapOverlayInstance[]) {
  overlays.forEach((overlay) => {
    try {
      overlay.setMap(null);
    } catch {
      // Rapid view changes can leave Google-managed overlays already detached.
    }
  });
}

type RoofMapFitTarget = {
  bounds: RoofGeoBounds | null;
  center: LatLngPoint | null;
};

function fitMapToRoofTarget({
  map,
  padding,
  target,
}: {
  map: GoogleMapInstance;
  padding: number;
  target: RoofMapFitTarget;
}) {
  const boundsLiteral = getBoundsLiteral(target.bounds);

  if (boundsLiteral && map.fitBounds) {
    map.fitBounds(boundsLiteral, padding);

    return window.setTimeout(() => {
      if (target.center) {
        map.setCenter(target.center);
      }

      const zoom = map.getZoom?.();
      if (typeof zoom === "number" && Number.isFinite(zoom) && zoom > 18) {
        map.setZoom(zoom - 1);
      }
    }, 180);
  }

  if (target.center) {
    map.setCenter(target.center);
  }
  map.setZoom(19);

  return null;
}

function getMapFitPadding(element: HTMLElement | null) {
  if (!element) {
    return 80;
  }

  return element.clientWidth >= 768 ? 104 : 52;
}

function getRoofMapFitTargetKey(target: RoofMapFitTarget) {
  const bounds = target.bounds;
  const center = target.center;

  return [
    bounds?.northeast.lat.toFixed(7) ?? "none",
    bounds?.northeast.lng.toFixed(7) ?? "none",
    bounds?.southwest.lat.toFixed(7) ?? "none",
    bounds?.southwest.lng.toFixed(7) ?? "none",
    center?.lat.toFixed(7) ?? "none",
    center?.lng.toFixed(7) ?? "none",
  ].join("|");
}

function buildRoofMapFitTarget({
  property,
  roofData,
}: {
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
}): RoofMapFitTarget {
  const buildingPoints = [
    ...outlineToLatLngPoints(roofData.roofOutline, roofData.roofBounds),
    ...boundsToLatLngPoints(roofData.roofBounds),
  ];
  const segmentPoints = roofData.roofSegments.flatMap((segment) => [
    ...outlineToLatLngPoints(segment.outline, roofData.roofBounds),
    ...boundsToLatLngPoints(segment.bounds),
  ]);
  const panelPoints = roofData.solarPanels.flatMap((panel) =>
    buildPanelCornerLatLngPoints({
      panel,
      panels: roofData.solarPanels,
      roofData,
    })
  );
  const fallbackPoints = property ? [property] : [];
  const allPoints = [
    ...buildingPoints,
    ...segmentPoints,
    ...panelPoints,
    ...fallbackPoints,
  ].filter(isValidLatLngPoint);
  const centroidSource =
    buildingPoints.filter(isValidLatLngPoint).length >= 3
      ? buildingPoints
      : segmentPoints.filter(isValidLatLngPoint).length >= 3
        ? segmentPoints
        : panelPoints.filter(isValidLatLngPoint).length
          ? panelPoints
          : fallbackPoints;

  if (!allPoints.length) {
    return {
      bounds: null,
      center: property,
    };
  }

  const bounds = expandGeoBoundsByMeters(
    latLngPointsToBounds(allPoints),
    getPropertyContextMeters(allPoints)
  );

  return {
    bounds,
    center: getLatLngCentroid(centroidSource.filter(isValidLatLngPoint)) ??
      getRoofBoundsCenter(bounds),
  };
}

function buildPanelCornerLatLngPoints({
  panel,
  panels,
  roofData,
}: {
  panel: RoofAnalysis["solarPanels"][number];
  panels: RoofAnalysis["solarPanels"];
  roofData: RoofAnalysis;
}) {
  const segment = roofData.roofSegments[panel.segmentIndex];
  const azimuth = Number.isFinite(panel.azimuthDeg)
    ? panel.azimuthDeg
    : segment?.azimuthDeg ?? roofData.primaryRoofAzimuth;
  const panelPath = buildPanelCornerPoints({
    centerLat: panel.center.lat,
    centerLng: panel.center.lng,
    orientation: panel.orientation,
    panelHeightMeters: roofData.panelHeightMeters,
    panelWidthMeters: roofData.panelWidthMeters,
    rotationDeg: inferPanelRotationDeg(panel, panels, azimuth),
  });

  return [panel.center, ...panelPath];
}

function buildPanelCornerPoints(params: {
  centerLat: number;
  centerLng: number;
  dimensionAdjustmentMeters?: number;
  orientation: "PORTRAIT" | "LANDSCAPE";
  rotationDeg: number;
  panelWidthMeters: number;
  panelHeightMeters: number;
}) {
  const shortSide = Math.min(params.panelWidthMeters, params.panelHeightMeters);
  const longSide = Math.max(params.panelWidthMeters, params.panelHeightMeters);
  const dimensionAdjustment = params.dimensionAdjustmentMeters ?? 0;
  const baseWidthMeters = params.orientation === "LANDSCAPE" ? longSide : shortSide;
  const baseHeightMeters = params.orientation === "LANDSCAPE" ? shortSide : longSide;
  const widthMeters = Math.max(
    baseWidthMeters * 0.62,
    baseWidthMeters + dimensionAdjustment
  );
  const heightMeters = Math.max(
    baseHeightMeters * 0.62,
    baseHeightMeters + dimensionAdjustment
  );
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const rotation = (params.rotationDeg * Math.PI) / 180;
  const corners = [
    { east: -halfWidth, north: -halfHeight },
    { east: halfWidth, north: -halfHeight },
    { east: halfWidth, north: halfHeight },
    { east: -halfWidth, north: halfHeight },
  ];

  return corners.map((corner) => {
    const rotatedEast =
      corner.east * Math.cos(rotation) + corner.north * Math.sin(rotation);
    const rotatedNorth =
      -corner.east * Math.sin(rotation) + corner.north * Math.cos(rotation);

    return offsetLatLngMeters({
      lat: params.centerLat,
      lng: params.centerLng,
      eastMeters: rotatedEast,
      northMeters: rotatedNorth,
    });
  });
}

function createRoofBoundsOverlay(
  googleApi: GoogleMapsApi,
  bounds: RoofGeoBounds | null,
  map: GoogleMapInstance
) {
  const boundsLiteral = getBoundsLiteral(bounds);
  if (!boundsLiteral) {
    return null;
  }

  const rectangle = new googleApi.maps.Rectangle({
    bounds: boundsLiteral,
    clickable: false,
    fillOpacity: 0,
    map,
    strokeColor: "#22d3ee",
    strokeOpacity: 0.22,
    strokeWeight: 1,
  });

  return rectangle;
}

function createRoofFootprintOverlay({
  googleApi,
  map,
  roofData,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
}) {
  const path = outlineToLatLngPath(googleApi, roofData.roofOutline, roofData.roofBounds);

  if (path.length < 3) {
    return null;
  }

  return new googleApi.maps.Polygon({
    clickable: false,
    fillColor: "#22d3ee",
    fillOpacity: 0.035,
    map,
    paths: path,
    strokeColor: "#67e8f9",
    strokeOpacity: 0.92,
    strokeWeight: 2,
  });
}

function createRoofSegmentOverlays({
  googleApi,
  map,
  roofData,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
}) {
  return roofData.roofSegments
    .map((segment, index) => {
      const path = outlineToLatLngPath(googleApi, segment.outline, roofData.roofBounds);

      if (path.length < 3) {
        return null;
      }

      return new googleApi.maps.Polygon({
        clickable: false,
        fillColor: index === 0 ? "#38bdf8" : "#fbbf24",
        fillOpacity: index === 0 ? 0.08 : 0.05,
        map,
        paths: path,
        strokeColor: index === 0 ? "#e0f2fe" : "#fde68a",
        strokeOpacity: 0.72,
        strokeWeight: 1,
      });
    })
    .filter((overlay): overlay is GoogleMapOverlayInstance => Boolean(overlay));
}

function createSetbackOverlay({
  googleApi,
  map,
  roofData,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
}) {
  const path = outlineToLatLngPath(googleApi, roofData.usableOutline, roofData.roofBounds);

  if (path.length < 3) {
    return null;
  }

  return new googleApi.maps.Polygon({
    clickable: false,
    fillOpacity: 0,
    map,
    paths: path,
    strokeColor: "#a7f3d0",
    strokeOpacity: 0.56,
    strokeWeight: 1,
  });
}

function createObstructionOverlays({
  googleApi,
  map,
  roofData,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
}) {
  return roofData.obstructionOutlines
    .map((outline) => {
      const path = outlineToLatLngPath(googleApi, outline, roofData.roofBounds);

      if (path.length < 3) {
        return null;
      }

      return new googleApi.maps.Polygon({
        clickable: false,
        fillColor: "#94a3b8",
        fillOpacity: 0.18,
        map,
        paths: path,
        strokeColor: "#cbd5e1",
        strokeOpacity: 0.5,
        strokeWeight: 1,
      });
    })
    .filter((overlay): overlay is GoogleMapOverlayInstance => Boolean(overlay));
}

function createDsmPlaneOverlays({
  extraction,
  googleApi,
  map,
}: {
  extraction: DsmPlaneExtraction;
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
}) {
  return extraction.planes.map((plane, index) => {
    const path = plane.path.map((point) =>
      new googleApi.maps.LatLng(point.lat, point.lng)
    );

    return new googleApi.maps.Polygon({
      clickable: false,
      fillColor: index === 0 ? "#38bdf8" : "#fbbf24",
      fillOpacity: index === 0 ? 0.085 : 0.052,
      map,
      paths: path,
      strokeColor: index === 0 ? "#e0f2fe" : "#fde68a",
      strokeOpacity: Math.max(0.42, plane.confidence),
      strokeWeight: 1,
    });
  });
}

function createPanelMapOverlays({
  googleApi,
  map,
  roofData,
  selectedPanelCount,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}) {
  const panelLayout = buildProfessionalPanelLayout({
    roofData,
    selectedPanelCount,
  });

  return panelLayout.map((placement) => {
      const path = placement.displayPath.map(
        (point) => new googleApi.maps.LatLng(point.lat, point.lng)
      );
      const segmentTone = placement.panel.segmentIndex % 3;
      const fillColor =
        segmentTone === 0 ? "#3b82f6" : segmentTone === 1 ? "#2563eb" : "#60a5fa";

      return new googleApi.maps.Polygon({
        clickable: false,
        fillColor,
        fillOpacity: 0.7,
        map,
        paths: path,
        strokeColor: "#ffffff",
        strokeOpacity: 0.92,
        strokeWeight: 1,
      });
    });
}

type PanelLayoutPlacement = {
  collisionPathMeters: MeterPoint[];
  displayPath: LatLngPoint[];
  panel: RoofAnalysis["solarPanels"][number];
};

type MeterPoint = {
  x: number;
  y: number;
};

function buildProfessionalPanelLayout({
  roofData,
  selectedPanelCount,
}: {
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}): PanelLayoutPlacement[] {
  const targetCount = clampNumber(
    selectedPanelCount,
    0,
    roofData.solarPanels.length
  );
  const origin =
    getRoofBoundsCenter(roofData.roofBounds) ??
    roofData.solarPanels[0]?.center ??
    null;

  if (!origin || targetCount <= 0) {
    return [];
  }

  const placedPanels: PanelLayoutPlacement[] = [];
  const orderedPanels = getOrderedPanelCandidates(roofData);

  for (const panel of orderedPanels) {
    const segment = roofData.roofSegments[panel.segmentIndex];
    const azimuth = Number.isFinite(panel.azimuthDeg)
      ? panel.azimuthDeg
      : segment?.azimuthDeg ?? roofData.primaryRoofAzimuth;
    const rotationDeg = inferPanelRotationDeg(panel, orderedPanels, azimuth);
    const boundary = getPanelBoundaryPolygon(panel, roofData);
    const displayPath = buildPanelCornerPoints({
      centerLat: panel.center.lat,
      centerLng: panel.center.lng,
      dimensionAdjustmentMeters: -PANEL_MODULE_GAP_METERS,
      orientation: panel.orientation,
      panelHeightMeters: roofData.panelHeightMeters,
      panelWidthMeters: roofData.panelWidthMeters,
      rotationDeg,
    });

    if (!isPanelInsideBoundary(displayPath, boundary)) {
      continue;
    }

    const collisionPathMeters = buildPanelCornerPoints({
      centerLat: panel.center.lat,
      centerLng: panel.center.lng,
      dimensionAdjustmentMeters: 0,
      orientation: panel.orientation,
      panelHeightMeters: roofData.panelHeightMeters,
      panelWidthMeters: roofData.panelWidthMeters,
      rotationDeg,
    }).map((point) => latLngToLocalMeters(point, origin));
    const hasCollision = placedPanels.some((placedPanel) =>
      convexPolygonsOverlap(
        collisionPathMeters,
        placedPanel.collisionPathMeters,
        PANEL_COLLISION_EPSILON_METERS
      )
    );

    if (hasCollision) {
      continue;
    }

    placedPanels.push({
      collisionPathMeters,
      displayPath,
      panel,
    });

    if (placedPanels.length >= targetCount) {
      break;
    }
  }

  return placedPanels;
}

function buildAcceptedPanelAnalysis(analysis: RoofAnalysis): RoofAnalysis {
  const originalPanelCandidateCount = Math.max(
    analysis.originalPanelCandidateCount ?? 0,
    analysis.solarPanels.length,
    analysis.panelCount
  );

  if (!analysis.validSite || !analysis.solarPanels.length) {
    return {
      ...analysis,
      acceptedPanelCount: analysis.panelCount,
      originalPanelCandidateCount,
      rejectedPanelCandidateCount: Math.max(
        0,
        originalPanelCandidateCount - analysis.panelCount
      ),
    };
  }

  const acceptedLayout = buildProfessionalPanelLayout({
    roofData: analysis,
    selectedPanelCount: analysis.solarPanels.length,
  });
  const acceptedPanels = acceptedLayout.map((placement) => placement.panel);
  const acceptedPanelCount = acceptedPanels.length;
  const rejectedPanelCandidateCount = Math.max(
    0,
    originalPanelCandidateCount - acceptedPanelCount
  );

  if (!acceptedPanelCount) {
    return {
      ...analysis,
      acceptedPanelCount: 0,
      annualKwh: 0,
      annualSavingsUSD: 0,
      originalPanelCandidateCount,
      panelCount: 0,
      rejectedPanelCandidateCount,
      solarPanels: [],
      systemKw: 0,
    };
  }

  const cappedConfigs = analysis.solarPanelConfigs.filter(
    (config) => config.panelsCount <= acceptedPanelCount
  );
  const selectedConfig = findNearestPanelConfig(
    cappedConfigs.length ? cappedConfigs : analysis.solarPanelConfigs,
    acceptedPanelCount
  );
  const panelEnergyTotal = acceptedPanels.reduce(
    (sum, panel) => sum + Math.max(panel.yearlyEnergyDcKwh, 0),
    0
  );
  const annualKwh = Math.max(
    0,
    Math.round(
      selectedConfig?.yearlyEnergyDcKwh ??
        (panelEnergyTotal > 0
          ? panelEnergyTotal
          : (analysis.annualKwh / Math.max(analysis.panelCount, 1)) *
            acceptedPanelCount)
    )
  );
  const segmentPanelCounts = acceptedPanels.reduce<Map<number, number>>(
    (counts, panel) => {
      counts.set(panel.segmentIndex, (counts.get(panel.segmentIndex) ?? 0) + 1);
      return counts;
    },
    new Map()
  );

  return {
    ...analysis,
    acceptedPanelCount,
    annualKwh,
    annualSavingsUSD: Math.round(annualKwh * 0.13),
    originalPanelCandidateCount,
    panelCount: acceptedPanelCount,
    rejectedPanelCandidateCount,
    roofSegments: analysis.roofSegments.map((segment, index) => ({
      ...segment,
      panelsFit: segmentPanelCounts.get(index) ?? 0,
    })),
    solarPanelConfigs: cappedConfigs.length ? cappedConfigs : analysis.solarPanelConfigs,
    solarPanels: acceptedPanels,
    systemKw:
      Math.round(
        ((acceptedPanelCount * (analysis.panelCapacityWatts || 400)) / 1000) * 10
      ) / 10,
  };
}

function getMaxSelectablePanelCount(roofData: RoofAnalysis) {
  return Math.max(
    1,
    roofData.solarPanels.length || roofData.acceptedPanelCount || roofData.panelCount
  );
}

function getOrderedPanelCandidates(roofData: RoofAnalysis) {
  const segmentRank = new Map(
    roofData.roofSegments
      .map((segment, index) => ({ index, segment }))
      .sort((left, right) => {
        if (left.segment.usable !== right.segment.usable) {
          return left.segment.usable ? -1 : 1;
        }

        return (
          right.segment.areaM2 - left.segment.areaM2 ||
          right.segment.panelsFit - left.segment.panelsFit ||
          left.index - right.index
        );
      })
      .map((entry, rank) => [entry.index, rank])
  );

  return [...roofData.solarPanels].sort((left, right) => {
    const leftRank = segmentRank.get(left.segmentIndex) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = segmentRank.get(right.segmentIndex) ?? Number.MAX_SAFE_INTEGER;

    return (
      leftRank - rightRank ||
      nullableSortValue(left.rowIndex) - nullableSortValue(right.rowIndex) ||
      nullableSortValue(left.columnIndex) - nullableSortValue(right.columnIndex) ||
      right.yearlyEnergyDcKwh - left.yearlyEnergyDcKwh
    );
  });
}

function nullableSortValue(value: number | null) {
  return value === null ? Number.MAX_SAFE_INTEGER : value;
}

function getPanelBoundaryPolygon(
  panel: RoofAnalysis["solarPanels"][number],
  roofData: RoofAnalysis
) {
  const segment = roofData.roofSegments[panel.segmentIndex];
  const segmentPolygon = segment
    ? outlineToLatLngPoints(segment.outline, roofData.roofBounds)
    : [];

  if (segmentPolygon.length >= 3) {
    return segmentPolygon;
  }

  const usablePolygon = outlineToLatLngPoints(
    roofData.usableOutline,
    roofData.roofBounds
  );

  if (usablePolygon.length >= 3) {
    return usablePolygon;
  }

  return outlineToLatLngPoints(roofData.roofOutline, roofData.roofBounds);
}

function isPanelInsideBoundary(
  panelPath: LatLngPoint[],
  boundary: LatLngPoint[]
) {
  if (boundary.length < 3) {
    return true;
  }

  return panelPath.every((point) => isLatLngPointInPolygon(point, boundary));
}

function isLatLngPointInPolygon(point: LatLngPoint, polygon: LatLngPoint[]) {
  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const crossesLatitude = (current.lat > y) !== (previous.lat > y);

    if (!crossesLatitude) {
      continue;
    }

    const intersectionX =
      ((previous.lng - current.lng) * (y - current.lat)) /
        (previous.lat - current.lat || Number.EPSILON) +
      current.lng;

    if (x < intersectionX) {
      inside = !inside;
    }
  }

  return inside;
}

function latLngToLocalMeters(point: LatLngPoint, origin: LatLngPoint): MeterPoint {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.01);

  return {
    x: (point.lng - origin.lng) * metersPerDegreeLng,
    y: (point.lat - origin.lat) * metersPerDegreeLat,
  };
}

function convexPolygonsOverlap(
  left: MeterPoint[],
  right: MeterPoint[],
  epsilon: number
) {
  const axes = [...getPolygonAxes(left), ...getPolygonAxes(right)];

  return axes.every((axis) => {
    const leftProjection = projectPolygon(left, axis);
    const rightProjection = projectPolygon(right, axis);

    return !(
      leftProjection.max <= rightProjection.min + epsilon ||
      rightProjection.max <= leftProjection.min + epsilon
    );
  });
}

function getPolygonAxes(points: MeterPoint[]) {
  const axes: MeterPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    if (!current || !next) {
      continue;
    }

    const edgeX = next.x - current.x;
    const edgeY = next.y - current.y;
    const length = Math.hypot(edgeX, edgeY);

    if (length <= Number.EPSILON) {
      continue;
    }

    axes.push({
      x: -edgeY / length,
      y: edgeX / length,
    });
  }

  return axes;
}

function projectPolygon(points: MeterPoint[], axis: MeterPoint) {
  return points.reduce(
    (projection, point) => {
      const value = point.x * axis.x + point.y * axis.y;

      return {
        max: Math.max(projection.max, value),
        min: Math.min(projection.min, value),
      };
    },
    {
      max: Number.NEGATIVE_INFINITY,
      min: Number.POSITIVE_INFINITY,
    }
  );
}

async function createAnnualFluxMapOverlay({
  googleApi,
  annualFluxUrl,
  solarMaskUrl,
  fallbackBounds,
  opacity,
}: {
  googleApi: GoogleMapsApi;
  annualFluxUrl: string | null;
  solarMaskUrl: string | null;
  fallbackBounds: RoofGeoBounds | null;
  opacity: number;
}) {
  if (!annualFluxUrl) {
    return null;
  }

  const heatmap = await buildAnnualFluxCanvas({
    annualFluxUrl,
    solarMaskUrl,
    fallbackBounds,
  });

  if (!heatmap) {
    return null;
  }

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.pointerEvents = "none";
  container.style.opacity = String(opacity);
  container.style.mixBlendMode = "screen";

  heatmap.canvas.style.width = "100%";
  heatmap.canvas.style.height = "100%";
  container.appendChild(heatmap.canvas);

  const overlay = new googleApi.maps.OverlayView();
  overlay.onAdd = function onAdd() {
    this.getPanes()?.overlayLayer?.appendChild(container);
  };
  overlay.draw = function draw() {
    const projection = this.getProjection();
    const ne = projection.fromLatLngToDivPixel(
      new googleApi.maps.LatLng(
        heatmap.bounds.northeast.lat,
        heatmap.bounds.northeast.lng
      )
    );
    const sw = projection.fromLatLngToDivPixel(
      new googleApi.maps.LatLng(
        heatmap.bounds.southwest.lat,
        heatmap.bounds.southwest.lng
      )
    );

    if (!ne || !sw) {
      return;
    }

    container.style.left = `${sw.x}px`;
    container.style.top = `${ne.y}px`;
    container.style.width = `${ne.x - sw.x}px`;
    container.style.height = `${sw.y - ne.y}px`;
  };
  overlay.onRemove = function onRemove() {
    container.remove();
  };

  return overlay;
}

async function buildAnnualFluxCanvas({
  annualFluxUrl,
  solarMaskUrl,
  fallbackBounds,
}: {
  annualFluxUrl: string;
  solarMaskUrl: string | null;
  fallbackBounds: RoofGeoBounds | null;
}) {
  const [fluxResponse, maskResponse] = await Promise.all([
    fetch(annualFluxUrl, { cache: "no-store" }),
    solarMaskUrl
      ? fetch(solarMaskUrl, { cache: "no-store" }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!fluxResponse.ok) {
    return null;
  }

  const fluxBuffer = await fluxResponse.arrayBuffer();
  const { fromArrayBuffer } = await import("geotiff");
  const fluxTiff = await fromArrayBuffer(fluxBuffer);
  const fluxImage = await fluxTiff.getImage();
  const width = fluxImage.getWidth();
  const height = fluxImage.getHeight();
  const fluxRaster = (await fluxImage.readRasters({
    interleave: true,
  })) as RasterData;
  let maskRaster: RasterData | null = null;

  if (maskResponse?.ok) {
    const maskTiff = await fromArrayBuffer(await maskResponse.arrayBuffer());
    const maskImage = await maskTiff.getImage();
    maskRaster = (await maskImage.readRasters({
      interleave: true,
    })) as RasterData;
  }

  const validValues = Array.from(fluxRaster).filter(
    (value, index) =>
      Number.isFinite(value) &&
      value > -9990 &&
      (!maskRaster || Number(maskRaster[index] ?? 0) > 0)
  ) as number[];

  if (!validValues.length) {
    return null;
  }

  validValues.sort((left, right) => left - right);
  const low = percentile(validValues, 0.08);
  const high = percentile(validValues, 0.92);
  const range = Math.max(high - low, 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const imageData = context.createImageData(width, height);
  const pixels = imageData.data;

  for (let index = 0; index < fluxRaster.length; index += 1) {
    const value = fluxRaster[index];
    const offset = index * 4;
    const maskValue = maskRaster ? Number(maskRaster[index] ?? 0) : 1;

    if (!Number.isFinite(value) || value <= -9990 || maskValue <= 0) {
      pixels[offset + 3] = 0;
      continue;
    }

    const normalized = clamp01((value - low) / range);
    const { r, g, b } = fluxColor(normalized);
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 140;
  }

  context.putImageData(imageData, 0, 0);

  return {
    canvas,
    bounds: getGeoTiffBounds(fluxImage, fallbackBounds),
  };
}

async function getDsmPlaneExtraction({
  dsmUrl,
  fallbackBounds,
  maskUrl,
}: {
  dsmUrl: string | null;
  fallbackBounds: RoofGeoBounds | null;
  maskUrl: string | null;
}) {
  if (!dsmUrl || !maskUrl) {
    return null;
  }

  const cacheKey = `${dsmUrl}|${maskUrl}`;
  const cached = dsmPlaneExtractionCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const promise = buildDsmPlaneExtraction({
    dsmUrl,
    fallbackBounds,
    maskUrl,
  }).catch(() => null);
  dsmPlaneExtractionCache.set(cacheKey, promise);

  return promise;
}

async function buildDsmPlaneExtraction({
  dsmUrl,
  fallbackBounds,
  maskUrl,
}: {
  dsmUrl: string;
  fallbackBounds: RoofGeoBounds | null;
  maskUrl: string;
}): Promise<DsmPlaneExtraction | null> {
  const [dsm, mask] = await Promise.all([
    readGeoTiffRaster(dsmUrl, fallbackBounds),
    readGeoTiffRaster(maskUrl, fallbackBounds),
  ]);

  if (!dsm || !mask || dsm.width !== mask.width || dsm.height !== mask.height) {
    return null;
  }

  return extractDsmPlanes({
    bounds: dsm.bounds,
    dsmRaster: dsm.raster,
    height: dsm.height,
    maskRaster: mask.raster,
    width: dsm.width,
  });
}

async function readGeoTiffRaster(
  url: string,
  fallbackBounds: RoofGeoBounds | null
) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const { fromArrayBuffer } = await import("geotiff");
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();

  return {
    bounds: getGeoTiffBounds(image, fallbackBounds),
    height: image.getHeight(),
    raster: (await image.readRasters({ interleave: true })) as RasterData,
    width: image.getWidth(),
  };
}

function extractDsmPlanes({
  bounds,
  dsmRaster,
  height,
  maskRaster,
  width,
}: {
  bounds: RoofGeoBounds;
  dsmRaster: RasterData;
  height: number;
  maskRaster: RasterData;
  width: number;
}): DsmPlaneExtraction | null {
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 180));
  const groups = new Map<number, Array<{ aspectDeg: number; slopeDeg: number; x: number; y: number }>>();
  const roofPixels: Array<{ x: number; y: number }> = [];

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const index = y * width + x;

      if (!isValidRoofRasterValue(dsmRaster[index], maskRaster[index])) {
        continue;
      }

      roofPixels.push({ x, y });

      const left = dsmRaster[index - 1];
      const right = dsmRaster[index + 1];
      const up = dsmRaster[index - width];
      const down = dsmRaster[index + width];

      if (
        !isValidRoofRasterValue(left, maskRaster[index - 1]) ||
        !isValidRoofRasterValue(right, maskRaster[index + 1]) ||
        !isValidRoofRasterValue(up, maskRaster[index - width]) ||
        !isValidRoofRasterValue(down, maskRaster[index + width])
      ) {
        continue;
      }

      const dzDx = (Number(right) - Number(left)) / 2;
      const dzDy = (Number(down) - Number(up)) / 2;
      const slopeDeg = Math.atan(Math.hypot(dzDx, dzDy)) * (180 / Math.PI);
      const aspectDeg = normalizeDegrees(Math.atan2(dzDx, -dzDy) * (180 / Math.PI));
      const bin = slopeDeg < 3 ? 0 : 1 + (Math.round(aspectDeg / 45) % 8);
      const group = groups.get(bin) ?? [];
      group.push({ aspectDeg, slopeDeg, x, y });
      groups.set(bin, group);
    }
  }

  const minimumPlanePixels = Math.max(20, Math.round(roofPixels.length * 0.055));
  const planes = [...groups.values()]
    .filter((group) => group.length >= minimumPlanePixels)
    .sort((left, right) => right.length - left.length)
    .slice(0, 4)
    .map((group) => {
      const hull = convexHullPixels(group);
      const path = hull.map((point) =>
        pixelToLatLng(point.x, point.y, width, height, bounds)
      );
      const slopeDeg =
        group.reduce((sum, point) => sum + point.slopeDeg, 0) / group.length;
      const aspectDeg =
        group.reduce((sum, point) => sum + point.aspectDeg, 0) / group.length;

      return {
        aspectDeg: Math.round(normalizeDegrees(aspectDeg)),
        confidence: clamp01(group.length / Math.max(roofPixels.length, 1)),
        path,
        slopeDeg: Math.round(slopeDeg * 10) / 10,
      };
    })
    .filter((plane) => plane.path.length >= 3);

  if (planes.length) {
    return { bounds, planes };
  }

  if (roofPixels.length >= 12) {
    return {
      bounds,
      planes: [
        {
          aspectDeg: 0,
          confidence: 0.38,
          path: convexHullPixels(roofPixels).map((point) =>
            pixelToLatLng(point.x, point.y, width, height, bounds)
          ),
          slopeDeg: 0,
        },
      ],
    };
  }

  return null;
}

function isValidRoofRasterValue(dsmValue: unknown, maskValue: unknown) {
  const heightValue = Number(dsmValue);

  return Number.isFinite(heightValue) && heightValue > -9990 && Number(maskValue ?? 0) > 0;
}

function pixelToLatLng(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: RoofGeoBounds
): LatLngPoint {
  const west = bounds.southwest.lng;
  const east = bounds.northeast.lng;
  const south = bounds.southwest.lat;
  const north = bounds.northeast.lat;

  return {
    lat: north - (north - south) * clamp01(y / Math.max(height - 1, 1)),
    lng: west + (east - west) * clamp01(x / Math.max(width - 1, 1)),
  };
}

function convexHullPixels(points: Array<{ x: number; y: number }>) {
  const sorted = [...points].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x
  );

  if (sorted.length <= 3) {
    return sorted;
  }

  const lower: Array<{ x: number; y: number }> = [];
  for (const point of sorted) {
    while (lower.length >= 2 && pixelCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Array<{ x: number; y: number }> = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && pixelCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function pixelCross(
  origin: { x: number; y: number },
  left: { x: number; y: number },
  right: { x: number; y: number }
) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function inferPanelRotationDeg(
  panel: RoofAnalysis["solarPanels"][number],
  panels: RoofAnalysis["solarPanels"],
  fallbackAzimuth: number
) {
  const rowNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
        candidate.rowIndex !== null &&
        candidate.rowIndex === panel.rowIndex &&
        candidate.columnIndex !== null &&
        panel.columnIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.columnIndex ?? 0) - (panel.columnIndex ?? 0)) -
        Math.abs((right.columnIndex ?? 0) - (panel.columnIndex ?? 0))
    )[0];

  if (rowNeighbor) {
    return normalizeDegrees(
      bearingDegrees(panel.center.lat, panel.center.lng, rowNeighbor.center.lat, rowNeighbor.center.lng) - 90
    );
  }

  const columnNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
        candidate.columnIndex !== null &&
        candidate.columnIndex === panel.columnIndex &&
        candidate.rowIndex !== null &&
        panel.rowIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.rowIndex ?? 0) - (panel.rowIndex ?? 0)) -
        Math.abs((right.rowIndex ?? 0) - (panel.rowIndex ?? 0))
    )[0];

  if (columnNeighbor) {
    return normalizeDegrees(
      bearingDegrees(panel.center.lat, panel.center.lng, columnNeighbor.center.lat, columnNeighbor.center.lng)
    );
  }

  return normalizeDegrees(fallbackAzimuth - 90);
}

function bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const toDegrees = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const deltaLng = toRadians(toLng - fromLng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function offsetLatLngMeters({
  lat,
  lng,
  eastMeters,
  northMeters,
}: {
  lat: number;
  lng: number;
  eastMeters: number;
  northMeters: number;
}) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

  return {
    lat: lat + northMeters / metersPerDegreeLat,
    lng: lng + eastMeters / metersPerDegreeLng,
  };
}

function getGeoTiffBounds(
  image: unknown,
  fallbackBounds: RoofGeoBounds | null
): RoofGeoBounds {
  const imageWithBounds = image as {
    getBoundingBox?: () => number[];
  };
  const box = imageWithBounds.getBoundingBox?.();

  if (box && box.length >= 4) {
    const [west, south, east, north] = box.map(Number);

    if (
      Number.isFinite(west) &&
      Number.isFinite(south) &&
      Number.isFinite(east) &&
      Number.isFinite(north) &&
      Math.abs(south) <= 90 &&
      Math.abs(north) <= 90 &&
      Math.abs(west) <= 180 &&
      Math.abs(east) <= 180
    ) {
      return {
        northeast: {
          lat: Math.max(north, south),
          lng: Math.max(east, west),
        },
        southwest: {
          lat: Math.min(north, south),
          lng: Math.min(east, west),
        },
      };
    }
  }

  return (
    fallbackBounds ?? {
      northeast: { lat: 0, lng: 0 },
      southwest: { lat: 0, lng: 0 },
    }
  );
}

function outlineToLatLngPath(
  googleApi: GoogleMapsApi,
  outline: Array<{ x: number; y: number }>,
  bounds: RoofGeoBounds | null
) {
  if (!bounds || outline.length < 3) {
    return [];
  }

  const west = bounds.southwest.lng;
  const east = bounds.northeast.lng;
  const south = bounds.southwest.lat;
  const north = bounds.northeast.lat;

  return outline.map((point) => {
    const x = clamp01(point.x / 100);
    const y = clamp01(point.y / 100);
    return new googleApi.maps.LatLng(
      north - (north - south) * y,
      west + (east - west) * x
    );
  });
}

function outlineToLatLngPoints(
  outline: Array<{ x: number; y: number }>,
  bounds: RoofGeoBounds | null
): LatLngPoint[] {
  if (!bounds || outline.length < 3) {
    return [];
  }

  const west = bounds.southwest.lng;
  const east = bounds.northeast.lng;
  const south = bounds.southwest.lat;
  const north = bounds.northeast.lat;

  return outline.map((point) => {
    const x = clamp01(point.x / 100);
    const y = clamp01(point.y / 100);
    return {
      lat: north - (north - south) * y,
      lng: west + (east - west) * x,
    };
  });
}

function boundsToLatLngPoints(bounds: RoofGeoBounds | null): LatLngPoint[] {
  if (!bounds) {
    return [];
  }

  return [
    { lat: bounds.northeast.lat, lng: bounds.northeast.lng },
    { lat: bounds.northeast.lat, lng: bounds.southwest.lng },
    { lat: bounds.southwest.lat, lng: bounds.northeast.lng },
    { lat: bounds.southwest.lat, lng: bounds.southwest.lng },
  ];
}

function latLngPointsToBounds(points: LatLngPoint[]): RoofGeoBounds {
  const initial = {
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
  };
  const bounds = points.reduce((accumulator, point) => ({
    maxLat: Math.max(accumulator.maxLat, point.lat),
    maxLng: Math.max(accumulator.maxLng, point.lng),
    minLat: Math.min(accumulator.minLat, point.lat),
    minLng: Math.min(accumulator.minLng, point.lng),
  }), initial);

  return {
    northeast: { lat: bounds.maxLat, lng: bounds.maxLng },
    southwest: { lat: bounds.minLat, lng: bounds.minLng },
  };
}

function expandGeoBoundsByMeters(
  bounds: RoofGeoBounds,
  meters: number
): RoofGeoBounds {
  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const latPadding = meters / metersPerDegreeLat;
  const lngPadding = meters / metersPerDegreeLng;

  return {
    northeast: {
      lat: bounds.northeast.lat + latPadding,
      lng: bounds.northeast.lng + lngPadding,
    },
    southwest: {
      lat: bounds.southwest.lat - latPadding,
      lng: bounds.southwest.lng - lngPadding,
    },
  };
}

function getPropertyContextMeters(points: LatLngPoint[]) {
  if (points.length < 2) {
    return 12;
  }

  const bounds = latLngPointsToBounds(points);
  const centerLat = (bounds.northeast.lat + bounds.southwest.lat) / 2;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const latSpanMeters =
    Math.abs(bounds.northeast.lat - bounds.southwest.lat) * metersPerDegreeLat;
  const lngSpanMeters =
    Math.abs(bounds.northeast.lng - bounds.southwest.lng) * metersPerDegreeLng;

  return clampNumber(Math.max(latSpanMeters, lngSpanMeters) * 0.22, 5, 12);
}

function getLatLngCentroid(points: LatLngPoint[]) {
  const validPoints = points.filter(isValidLatLngPoint);

  if (!validPoints.length) {
    return null;
  }

  return {
    lat:
      validPoints.reduce((sum, point) => sum + point.lat, 0) /
      validPoints.length,
    lng:
      validPoints.reduce((sum, point) => sum + point.lng, 0) /
      validPoints.length,
  };
}

function isValidLatLngPoint(point: LatLngPoint | null | undefined): point is LatLngPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180
  );
}

function getBoundsLiteral(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  return {
    north: bounds.northeast.lat,
    south: bounds.southwest.lat,
    east: bounds.northeast.lng,
    west: bounds.southwest.lng,
  };
}

function getRoofBoundsCenter(bounds: RoofGeoBounds | null) {
  if (!bounds) {
    return null;
  }

  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
}

function PanelSelectionSlider({
  value,
  max,
  onChange,
  canRenderPanels,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  canRenderPanels: boolean;
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
            Adjust the accepted module count against the current roof model and economics.
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
      {!canRenderPanels ? (
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Google Solar did not return individual module coordinates for this property, so the map keeps the roof surfaces visible without synthetic panel overlays.
        </p>
      ) : null}
    </div>
  );
}

function SunroofSummaryCard({
  address,
  metrics,
  confidence,
}: {
  address: string;
  metrics: AnalysisMetrics;
  confidence: number;
}) {
  const usableAreaSqFt = metrics.usableArea * 10.7639;
  const twentyYearSavings = metrics.selectedAnnualSavingsUSD * 20;

  return (
    <div className="overflow-hidden rounded-[1.15rem] border border-black/10 bg-white/95 text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.18)] backdrop-blur">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[0.64rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
          Preliminary property model
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-700">{address}</p>
      </div>

      <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
        <div className="flex items-center justify-between gap-3">
        <span>Solar suitability estimate</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {confidence}/100
          </span>
        </div>
      </div>

      <div className="space-y-0">
        <SummaryMetric
          tone="sun"
          value={`${metrics.annualSunlightHours.toLocaleString()} hours of usable sunlight per year`}
          detail="Estimated from live annual flux and roof orientation data"
        />
        <SummaryMetric
          tone="area"
          value={`${Math.round(usableAreaSqFt).toLocaleString()} sq ft available for solar panels`}
          detail="Based on detected usable roof area and setback-adjusted panel fit"
        />
      </div>

      <div className="border-t-4 border-sky-500 bg-slate-50 px-4 py-3">
        <p className="text-[2rem] font-light tracking-tight text-slate-900">
          ${twentyYearSavings.toLocaleString()}
        </p>
        <p className="text-sm text-slate-600">
          Modeled 20-year savings using the current panel selection
        </p>
      </div>
    </div>
  );
}

function SummaryMetric({
  tone,
  value,
  detail,
}: {
  tone: "sun" | "area";
  value: string;
  detail: string;
}) {
  const iconClass =
    tone === "sun"
      ? "bg-amber-100 text-amber-500"
      : "bg-fuchsia-100 text-fuchsia-500";

  return (
    <div className="flex items-start gap-4 border-b border-slate-200 px-4 py-4 last:border-b-0">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        <span
          className={`h-3 w-3 rounded-full ${tone === "sun" ? "bg-amber-500" : "bg-fuchsia-500"}`}
        />
      </div>
      <div>
        <p className="text-[1.05rem] leading-6 text-slate-900">{value}</p>
        <p className="mt-1 text-sm leading-5 text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function RoofStatsPanel({
  roofData,
  metrics,
}: {
  roofData: RoofAnalysis;
  metrics: AnalysisMetrics;
}) {
  const primarySegment = roofData.roofSegments[0];
  const secondarySegment = roofData.roofSegments[1];

  return (
    <div className="mt-4 rounded-[1.45rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-4 shadow-[0_10px_28px_rgba(2,8,20,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
            Roof stats
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Solar API roof measurements with the current accepted panel count.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-300">
          Solar API
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <MetricRow label="Roof width" source="Solar API" value={`${roofData.widthM.toFixed(1)} m`} />
        <MetricRow label="Roof depth" source="Solar API" value={`${roofData.depthM.toFixed(1)} m`} />
        <MetricRow label="Gross roof area" source="Solar API" value={`${metrics.roofArea.toFixed(1)} m²`} />
        <MetricRow label="Usable roof area" source="Solar API" value={`${metrics.usableArea.toFixed(1)} m²`} />
        <MetricRow label="Annual sunlight" source="Solar API" value={`${metrics.annualSunlightHours.toLocaleString()} hrs`} />
        <MetricRow label="Average roof pitch" source="Solar API" value={`${metrics.averageRoofPitch.toFixed(1)}°`} />
        <MetricRow label="Primary orientation" source="Solar API" value={metrics.orientationLabel} />
        <MetricRow label="Panel count" source="Solar API" value={`${metrics.selectedPanelCount}`} />
        <MetricRow label="Rooftop score" source="Solar API" value={`${roofData.rooftopConfidenceScore}/100`} />
        <MetricRow label="Estimated payback" source="Modeled" value={`${metrics.roiYears.toFixed(1)} yrs`} />
      </div>

      <div className="mt-4 rounded-[1rem] border border-white/8 bg-white/[0.03] p-3">
        <p className="text-[0.56rem] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Segment breakdown
        </p>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">Primary</span>
            <span className="text-white">
              {primarySegment ? `${primarySegment.areaM2.toFixed(1)} m²` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">Secondary</span>
            <span className="text-white">
              {secondarySegment ? `${secondarySegment.areaM2.toFixed(1)} m²` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">Garage</span>
            <span className="text-white">
              {roofData.roofSegments[2]
                ? `${roofData.roofSegments[2].areaM2.toFixed(1)} m²`
                : "-"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function fluxColor(value: number) {
  const shade = { r: 30, g: 64, b: 175 };
  const warm = { r: 251, g: 191, b: 36 };
  const sunny = { r: 249, g: 115, b: 22 };

  if (value <= 0.5) {
    return blendColor(shade, warm, value / 0.5);
  }

  return blendColor(warm, sunny, (value - 0.5) / 0.5);
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

function findNearestPanelConfig(
  configs: RoofAnalysis["solarPanelConfigs"],
  panelCount: number
) {
  if (!configs.length) {
    return null;
  }

  return (
    configs.find((config) => config.panelsCount === panelCount) ??
    configs
      .filter((config) => config.panelsCount <= panelCount)
      .at(-1) ??
    configs.reduce((closest, config) =>
      Math.abs(config.panelsCount - panelCount) <
      Math.abs(closest.panelsCount - panelCount)
        ? config
        : closest
    )
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

function MetricRow({
  label,
  source,
  value,
}: {
  label: string;
  source?: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm">
      <span className="flex flex-wrap items-center gap-2 text-slate-400">
        {label}
        {source ? (
          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.14em] text-slate-300">
            {source}
          </span>
        ) : null}
      </span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function CompactMapStat({
  label,
  source,
  value,
}: {
  label: string;
  source: string;
  value: string;
}) {
  return (
    <div className="rounded-[0.9rem] border border-white/8 bg-white/[0.035] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.55rem] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {label}
        </p>
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.14em] text-slate-300">
          {source}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function FinancialSnapshot({ metrics }: { metrics: AnalysisMetrics }) {
  return (
    <div className="rounded-[1.45rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-4 shadow-[0_10px_28px_rgba(2,8,20,0.18)]">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
        Savings model
      </p>
      <div className="mt-4 grid gap-3">
        <MetricRow label="Estimated system size" source="User-adjusted" value={`${metrics.selectedSystemKw.toFixed(1)} kW`} />
        <MetricRow label="Monthly savings" source="Modeled" value={`$${metrics.monthlySavings.toLocaleString()}`} />
        <MetricRow label="Yearly savings" source="Modeled" value={`$${metrics.selectedAnnualSavingsUSD.toLocaleString()}`} />
        <MetricRow label="Estimated payback" source="Modeled" value={`${metrics.roiYears.toFixed(1)} yrs`} />
        <MetricRow label="Financing from" source="Illustrative" value={`$${metrics.financingFrom}/mo`} />
      </div>
    </div>
  );
}

function SegmentationPanel({ roofData }: { roofData: RoofAnalysis }) {
  return (
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
                      Math.round((segment.panelsFit / Math.max(roofData.panelCount, 1)) * 100)
                    )
                  )}%`,
                }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <span>{segment.areaM2.toFixed(1)} m²</span>
              <span>{formatAzimuth(segment.azimuthDeg)}</span>
            </div>
          </div>
        ))}
      </div>
    </SidebarPanel>
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

function formatAzimuth(value: number) {
  const normalized = ((value % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return azimuthLabels[index];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

