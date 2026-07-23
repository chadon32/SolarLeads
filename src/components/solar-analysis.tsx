"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { formatDisplayAddress } from "@/lib/address-format";
import {
  getGoogleBoundsLiteral,
  getRoofAnalysisViewport,
} from "@/lib/roof-analysis-viewport";
import {
  calculateSunlightQuality,
  getRoofQualityLabel,
  type RoofQualityTone,
} from "@/lib/solar-advisor";
import { trackEvent } from "@/lib/analytics";
import { insetPolygon, type RoofGeoBounds, type RoofAnalysis } from "@/lib/roof-analysis";
import {
  getGeoTiffBounds,
  readGeoTiffRaster,
  type RasterData,
} from "@/lib/geotiff-utils";
import type { RoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { INSTALLED_COST_PER_WATT } from "@/lib/solar-assumptions";
import {
  buildSolarMetrics,
  formatCompassDirection,
  getMaxPanelCount,
  getProviderPanelCandidateCount,
  getRecommendedPanelCount,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-metrics";
import {
  getPanelFit,
  getShortPanelName,
  SOLAR_PANELS,
  type SolarPanel,
} from "@/lib/solarPanels";
import {
  buildPanelCornerLatLngPoints,
  buildPanelPolygonPath,
  getPanelFallbackAzimuthDeg,
  isValidLatLngPoint,
  offsetLatLngMeters,
  SOLAR_PANEL_SEAM_INSET_METERS,
  type LatLngPoint,
} from "@/lib/panel-geometry";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";

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
  monthlyBill?: number;
  activePanelCount?: number | null;
  onAnalysisChange?: (analysis: RoofAnalysis | null) => void;
  onAnalysisProofChange?: (proof: RoofAnalysisProof | null) => void;
  onSignedAnalysisChange?: (analysis: RoofAnalysis | null) => void;
  onActivePanelCountChange?: (panelCount: number) => void;
  selectedPanel?: SolarPanel | null;
  onSelectedPanelIdChange?: (panelId: string) => void;
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
  analysisProof?: RoofAnalysisProof | null;
  fallback?: RoofAnalysis;
  message?: string;
  detail?: string;
};

type ViewMode = "overview" | "irradiance" | "model3d";

const RoofScene3D = dynamic(() => import("@/components/roof-scene-3d"), {
  ssr: false,
});

type LayerVisibility = {
  panels: boolean;
  roofPlanes: boolean;
  sunlight: boolean;
};

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
    Polyline: new (
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
  { id: "irradiance", label: "Sunlight" },
  { id: "model3d", label: "3D Model" },
];

function getInitialRoofAnalysisLayers(): LayerVisibility {
  return {
    panels: true,
    // Planes off by default so the module array is the hero on first paint.
    roofPlanes: false,
    sunlight: false,
  };
}

const dsmPlaneExtractionCache = new Map<string, Promise<DsmPlaneExtraction | null>>();
const VISUAL_ROOF_INSET_PERCENT = 0.8;
const VISUAL_SEGMENT_INSET_PERCENT = 0.6;
const VISUAL_USABLE_INSET_PERCENT = 2.2;

export function SolarAnalysis({
  address,
  activePanelCount,
  compact = false,
  location,
  monthlyBill,
  onAnalysisChange,
  onAnalysisProofChange,
  onSignedAnalysisChange,
  onActivePanelCountChange,
  selectedPanel,
  onSelectedPanelIdChange,
}: SolarAnalysisProps) {
  const [stage, setStage] = useState<
    "idle" | "resolving" | "fetching" | "analyzing" | "done" | "invalid" | "error"
  >("idle");
  const [satelliteImage, setSatelliteImage] = useState<string | null>(null);
  const [annualFluxUrl, setAnnualFluxUrl] = useState<string | null>(null);
  const [dsmUrl, setDsmUrl] = useState<string | null>(null);
  const [solarMaskUrl, setSolarMaskUrl] = useState<string | null>(null);
  const [solarRgbUrl, setSolarRgbUrl] = useState<string | null>(null);
  const [roofData, setRoofData] = useState<RoofAnalysis | null>(null);
  const [resolvedProperty, setResolvedProperty] =
    useState<ResolvedProperty | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(
    getInitialRoofAnalysisLayers
  );
  const selectedPanelCount = activePanelCount ?? 0;
  const setSelectedPanelCount = useCallback(
    (nextPanelCount: number) => {
      onActivePanelCountChange?.(nextPanelCount);
    },
    [onActivePanelCountChange]
  );
  const selectViewMode = useCallback((nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    setLayerVisibility((current) => ({
      ...current,
      sunlight: nextViewMode === "irradiance",
    }));
  }, []);
  const updateLayerVisibility = useCallback((nextVisibility: LayerVisibility) => {
    setLayerVisibility(nextVisibility);
    // In 3D the sunlight toggle swaps the drape texture without leaving 3D.
    setViewMode((current) =>
      current === "model3d"
        ? current
        : nextVisibility.sunlight
          ? "irradiance"
          : current === "irradiance"
            ? "overview"
            : current
    );
  }, []);

  useEffect(() => {
    const trimmedAddress = address.trim();

    if (!trimmedAddress) {
      const resetHandle = window.requestAnimationFrame(() => {
        setStage("idle");
        setSatelliteImage(null);
        setAnnualFluxUrl(null);
        setDsmUrl(null);
        setSolarMaskUrl(null);
        setSolarRgbUrl(null);
        setRoofData(null);
        setSelectedPanelCount(0);
        setResolvedProperty(null);
        setNotice(null);
        setErrorMessage("");
        setViewMode("overview");
        setLayerVisibility(getInitialRoofAnalysisLayers());
        onAnalysisChange?.(null);
        onAnalysisProofChange?.(null);
        onSignedAnalysisChange?.(null);
      });

      return () => window.cancelAnimationFrame(resetHandle);
    }

    const controller = new AbortController();
    let cancelled = false;
    const resetLayersHandle = window.requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      setViewMode("overview");
      setLayerVisibility(getInitialRoofAnalysisLayers());
    });

    const runAnalysis = async () => {
      try {
        setStage("resolving");
        setNotice(null);
        setErrorMessage("");
        setRoofData(null);
        setAnnualFluxUrl(null);
        setDsmUrl(null);
        setSolarMaskUrl(null);
        setSolarRgbUrl(null);
        onAnalysisChange?.(null);
        onAnalysisProofChange?.(null);
        onSignedAnalysisChange?.(null);

        const property = await resolveProperty(
          trimmedAddress,
          controller.signal
        );

        if (cancelled) {
          return;
        }

        setResolvedProperty(property);
        setStage("analyzing");

        const analysisResponse = await fetch("/api/analyze-roof", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            address: property.address,
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

          // Rate limits / outages are temporary — don't frame them as "no roof".
          if (analysisResponse.status === 429 || analysisResponse.status >= 500) {
            setStage("error");
            setRoofData(null);
            onAnalysisChange?.(null);
            onAnalysisProofChange?.(null);
            onSignedAnalysisChange?.(null);
            setErrorMessage(message);
            return;
          }

          setStage("invalid");
          setRoofData(nextRoofData ?? null);
          onAnalysisChange?.(nextRoofData ?? null);
          onAnalysisProofChange?.(null);
          onSignedAnalysisChange?.(null);
          setErrorMessage(message);
          return;
        }

        if (!nextRoofData.validSite || !nextRoofData.rooftopDetected) {
          setRoofData(nextRoofData);
          onAnalysisChange?.(nextRoofData);
          onAnalysisProofChange?.(null);
          onSignedAnalysisChange?.(null);
          setStage("invalid");
          setErrorMessage(
            analysisPayload.message ??
              nextRoofData.invalidReason ??
              "A usable residential rooftop could not be confirmed for this address."
          );
          return;
        }

        setRoofData(nextRoofData);
        // Default to a practical bill-offset size, not Google's max packing.
        setSelectedPanelCount(
          getRecommendedPanelCount(nextRoofData, { monthlyBill })
        );
        onAnalysisChange?.(nextRoofData);
        onAnalysisProofChange?.(analysisPayload.analysisProof ?? null);
        onSignedAnalysisChange?.(nextRoofData);

        setStage("fetching");
        const [imageResponse, dataLayersResponse] = await Promise.all([
          fetch(
            `/api/satellite-image?lat=${encodeURIComponent(
              property.lat
            )}&lng=${encodeURIComponent(property.lng)}`,
            { signal: controller.signal }
          ),
          fetch(
            `/api/solar/data-layers?lat=${encodeURIComponent(
              property.lat
            )}&lng=${encodeURIComponent(property.lng)}`,
            { signal: controller.signal }
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

        setSatelliteImage(
          `data:${imagePayload.mimeType};base64,${imagePayload.base64}`
        );
        if (dataLayersResponse?.ok) {
          const dataLayersPayload: SolarDataLayersPayload =
            await dataLayersResponse.json().catch(() => ({}));
          setAnnualFluxUrl(dataLayersPayload.annualFluxUrl ?? null);
          setDsmUrl(dataLayersPayload.dsmUrl ?? null);
          setSolarMaskUrl(dataLayersPayload.maskUrl ?? null);
          setSolarRgbUrl(dataLayersPayload.rgbUrl ?? null);
        }
        setStage("done");
        trackEvent("solar_data_loaded", {
          panel_count_bucket: getPanelCountBucket(
            nextRoofData.panelCount
          ),
        });
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
      window.cancelAnimationFrame(resetLayersHandle);
      controller.abort();
    };
  }, [
    address,
    location,
    onAnalysisChange,
    onAnalysisProofChange,
    onSignedAnalysisChange,
    monthlyBill,
    setSelectedPanelCount,
  ]);

  const metrics = useMemo(() => {
    if (!roofData) {
      return null;
    }

    const maxPanels = getMaxSelectablePanelCount(roofData);
    const livePanelCount = clampNumber(
      selectedPanelCount ||
        getRecommendedPanelCount(roofData, { monthlyBill }),
      1,
      maxPanels
    );
    const sharedMetrics = buildSolarMetrics(roofData, {
      monthlyBill,
      selectedPanelCount: livePanelCount,
    });
    const panelWatts = selectedPanel?.watts ?? STANDARD_PANEL_WATTS;
    const selectedPanelFit = selectedPanel
      ? getPanelFit(selectedPanel, {
          roofData,
          monthlyBill,
          selectedPanelCount: livePanelCount,
        })
      : null;
    const estimatedNetCost =
      selectedPanelFit?.netCost ??
      livePanelCount * panelWatts * INSTALLED_COST_PER_WATT;
    const selectedAnnualKwh = selectedPanelFit?.annualKwh ?? sharedMetrics.annualKwh;
    const selectedAnnualSavingsUSD =
      selectedPanelFit?.annualSavings ?? sharedMetrics.annualSavings;
    const carbonFactorKgPerMwh =
      roofData.carbonOffsetFactorKgPerMwh && roofData.carbonOffsetFactorKgPerMwh > 0
        ? roofData.carbonOffsetFactorKgPerMwh
        : 390;
    const carbonOffsetLbs = Math.round(
      (selectedAnnualKwh / 1000) * carbonFactorKgPerMwh * 2.205
    );
    const carbonOffsetTons = carbonOffsetLbs / 2000;
    const treesEquivalent = Math.max(1, Math.round(carbonOffsetLbs / 48));
    const recommendedSegment =
      [...roofData.roofSegments]
        .sort((left, right) => right.panelsFit - left.panelsFit)
        .find((segment) => segment.usable) ?? roofData.roofSegments[0];

    return {
      roofArea: sharedMetrics.grossRoofAreaM2,
      usableArea: sharedMetrics.usableRoofAreaM2,
      averageRoofPitch: sharedMetrics.avgPitchDeg,
      annualSunlightHours: sharedMetrics.annualSunlightHours,
      selectedPanelCount: sharedMetrics.panelCount,
      selectedSystemKw:
        selectedPanelFit?.systemKw ??
        Math.round(((livePanelCount * panelWatts) / 1000) * 10) / 10,
      selectedAnnualKwh,
      selectedAnnualSavingsUSD,
      monthlySavings: Math.round(selectedAnnualSavingsUSD / 12),
      roiYears:
        selectedPanelFit?.paybackYears ??
        (selectedAnnualSavingsUSD > 0
          ? Math.round((estimatedNetCost / selectedAnnualSavingsUSD) * 10) / 10
          : 0),
      carbonOffsetLbs,
      carbonOffsetTons,
      treesEquivalent,
      recommendedSegment,
      financingFrom: Math.round(estimatedNetCost / 300),
      orientationLabel: sharedMetrics.primaryOrientationLabel,
    };
  }, [monthlyBill, roofData, selectedPanel, selectedPanelCount]);

  const stageStep =
    stage === "resolving"
      ? { label: "Resolving property coordinates...", pct: 14 }
      : stage === "fetching"
        ? { label: "Analyzing roof with Google Solar data...", pct: 38 }
        : stage === "analyzing"
          ? { label: "Analyzing roof with Google Solar data...", pct: 76 }
          : null;

  if (stage === "error") {
    const isRateLimited = /too many|try again shortly|daily roof analysis/i.test(
      errorMessage
    );
    return (
      <section className="space-y-5">
        <div className="rounded-[1.8rem] border border-rose-400/20 bg-rose-950/20 p-6 text-sm leading-7 text-rose-200">
          <p className="text-base font-semibold text-white">
            {isRateLimited
              ? "Roof analysis is temporarily limited."
              : "Solar data not available for this address."}
          </p>
          <p className="mt-2">
            {isRateLimited
              ? "Please wait a minute and search the address again. Cached results should load immediately."
              : "Try a residential address in Arizona."}
          </p>
          {errorMessage ? (
            <p className="mt-3 text-xs text-rose-100/62">Detail: {errorMessage}</p>
          ) : null}
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
    <section className={`w-full min-w-0 max-w-full ${compact ? "space-y-3" : "space-y-6"}`}>
      {stageStep ? (
        <AnalysisProgress step={stageStep.label} pct={stageStep.pct} />
      ) : null}

      {satelliteImage && stage !== "done" ? (
        <div className={compact ? "grid gap-4" : "grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_22rem]"}>
          <div className="overflow-hidden rounded-[1.85rem] border border-white/10 bg-slate-950/76 shadow-[0_12px_42px_rgba(2,8,20,0.36)]">
            <ViewportHeader
              address={resolvedProperty?.address ?? address}
              viewMode={viewMode}
              onSelectView={selectViewMode}
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
                    Analyzing roof with Google Solar data...
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
          <article className="w-full min-w-0 max-w-full overflow-hidden rounded-[1.5rem] border border-cyan-200/12 bg-slate-900/78 shadow-[0_14px_44px_rgba(2,8,20,0.36)]">
            <ViewportHeader
              address={resolvedProperty?.address ?? address}
              viewMode={viewMode}
              onSelectView={selectViewMode}
            />
            <div className="border-t border-white/8 p-3">
              <div className="relative overflow-hidden rounded-[1.1rem] border border-white/12 bg-slate-800/35">
                <ViewportCanvas
                  annualFluxUrl={annualFluxUrl}
                  dsmUrl={dsmUrl}
                  solarMaskUrl={solarMaskUrl}
                  solarRgbUrl={solarRgbUrl}
                  viewMode={viewMode}
                  address={resolvedProperty?.address ?? address}
                  compact
                  property={resolvedProperty}
                  roofData={roofData}
                  layerVisibility={layerVisibility}
                  onLayerVisibilityChange={updateLayerVisibility}
                  selectedPanelCount={metrics.selectedPanelCount}
                  selectedPanel={selectedPanel}
                  onSelectedPanelIdChange={onSelectedPanelIdChange}
                />
              </div>
              <div className="mt-3">
                <PanelSelectionSlider
                  value={metrics.selectedPanelCount}
                  max={getMaxSelectablePanelCount(roofData)}
                  onChange={setSelectedPanelCount}
                  canRenderPanels={roofData.solarPanels.length > 0}
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <CompactMapStat
                  label="Panel layout"
                  source="Recommended"
                  value={`${metrics.selectedPanelCount} of ${getMaxSelectablePanelCount(roofData)} panels`}
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
                <CompactMapStat
                  label="Est. savings"
                  source="Modeled"
                  value={`$${metrics.selectedAnnualSavingsUSD.toLocaleString()}`}
                />
                <CompactMapStat
                  label="Payback"
                  source="Modeled"
                  value={`${metrics.roiYears.toFixed(1)} yrs`}
                />
              </div>
              <div className="mt-3">
                <ConfidenceReadouts roofData={roofData} />
              </div>
              <div className="mt-3 rounded-[1rem] border border-white/10 bg-slate-950/62 p-3 text-xs leading-5 text-slate-200">
                <p>
                  Panel positions come from the Google Solar API model for this
                  roof, aligned to a rack grid for display.
                </p>
                <p className="mt-2 text-slate-400">
                  Final panel placement requires installer verification - roof
                  measurements, fire setbacks, and electrical design can adjust
                  the layout.
                </p>
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
                onSelectView={selectViewMode}
              />
              <div className="border-t border-white/8 p-4 sm:p-5">
                <div className="relative overflow-hidden rounded-[1.7rem] border border-white/8">
                  <ViewportCanvas
                    annualFluxUrl={annualFluxUrl}
                    dsmUrl={dsmUrl}
                    solarMaskUrl={solarMaskUrl}
                    solarRgbUrl={solarRgbUrl}
                    viewMode={viewMode}
                    address={resolvedProperty?.address ?? address}
                    property={resolvedProperty}
                    roofData={roofData}
                    layerVisibility={layerVisibility}
                    onLayerVisibilityChange={updateLayerVisibility}
                    selectedPanelCount={metrics.selectedPanelCount}
                    selectedPanel={selectedPanel}
                    onSelectedPanelIdChange={onSelectedPanelIdChange}
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
                  Roof geometry, usable solar area, and panel positions are tied to the Google Solar building record returned for this property. Final placement is verified by your installer.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill label={`${roofData.confidence} confidence`} tone="cyan" />
                  <Pill label={`${roofData.rooftopConfidenceScore}/100 rooftop score`} />
                  <Pill label={`${metrics.orientationLabel} orientation`} />
                </div>
                <div className="mt-4">
                  <ConfidenceReadouts roofData={roofData} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  {notice ?? roofData.confidenceNote}
                </p>
              </SidebarPanel>

              <PanelSelectionSlider
                value={metrics.selectedPanelCount}
                max={getMaxSelectablePanelCount(roofData)}
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
                  Save the roof geometry, estimated panel capacity, and modeled economics into a preliminary estimate for installer review.
                </p>
                <div className="mt-5 grid gap-3">
                  <ButtonLink href="#contact" variant="primary" className="w-full">
                    Generate full report
                  </ButtonLink>
                  <ButtonLink href="#contact" variant="secondary" className="w-full">
                    Send full report
                  </ButtonLink>
                </div>
              </SidebarPanel>
            </aside>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <IntelligenceCard
              eyebrow="Site findings"
              title="Rooftop analysis summary"
              body={`The primary roof plane faces ${metrics.orientationLabel} across usable roof surfaces. The current model marks ${roofData.usablePctRoof}% of the roof as solar-ready with ${roofData.shadingRisk} shading exposure.`}
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
  const displayAddress = formatDisplayAddress(address);

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Rooftop analysis
          </p>
          <p className="mt-2 max-w-2xl break-words text-sm leading-6 text-slate-300">
            Roof measurements and annual flux are projected from the current Solar API building model onto the rooftop image.
          </p>
        </div>
        <div className="max-w-full break-words rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs leading-5 text-slate-300 lg:rounded-full">
          {displayAddress}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Rooftop analysis views"
        className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"
      >
        {viewModes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={viewMode === mode.id}
            onClick={() =>
              onSelectView(
                viewMode === mode.id && mode.id !== "overview"
                  ? "overview"
                  : mode.id
              )
            }
            className={`min-h-11 w-full rounded-full px-2 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] transition sm:w-auto sm:px-3.5 sm:text-xs sm:tracking-[0.24em] ${
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

function ModuleDesignPanel({
  selectedPanel,
  selectedPanelCount,
  onSelectedPanelIdChange,
}: {
  selectedPanel?: SolarPanel | null;
  selectedPanelCount: number;
  onSelectedPanelIdChange: (panelId: string) => void;
}) {
  const active = selectedPanel ?? SOLAR_PANELS[0];
  const systemKw =
    Math.round(((selectedPanelCount * active.watts) / 1000) * 10) / 10;

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 hidden max-h-[calc(100%-1.5rem)] w-60 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:block">
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">
        Solar Panel
      </p>

      <label className="mt-3 block text-[0.6rem] font-medium uppercase tracking-[0.14em] text-white/55">
        Module
        <select
          value={active.id}
          onChange={(event) => onSelectedPanelIdChange(event.target.value)}
          className="mt-1.5 min-h-10 w-full rounded-lg border border-white/12 bg-white/[0.06] px-2.5 py-2 text-sm font-medium text-white outline-none transition focus:border-cyan-300/60"
        >
          {SOLAR_PANELS.map((panel) => (
            <option key={panel.id} value={panel.id} className="bg-slate-900">
              {getShortPanelName(panel)} · {panel.model}
            </option>
          ))}
        </select>
      </label>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/55">Dimensions</dt>
          <dd className="text-right font-medium text-white/90">
            {active.dimensions}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/55">Rated power</dt>
          <dd className="font-medium text-white/90">{active.watts} W</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/55">Efficiency</dt>
          <dd className="font-medium text-white/90">
            {active.efficiency}%
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/55">Tier</dt>
          <dd className="font-medium capitalize text-white/90">
            {active.tier}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.06] px-3 py-2">
        <p className="text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-cyan-100/75">
          System size
        </p>
        <p className="mt-0.5 text-base font-semibold text-white">
          {systemKw} kW
          <span className="ml-1.5 text-xs font-normal text-white/55">
            · {selectedPanelCount} modules
          </span>
        </p>
      </div>
    </div>
  );
}

function ViewportCanvas({
  annualFluxUrl,
  dsmUrl,
  solarMaskUrl,
  solarRgbUrl,
  viewMode,
  address,
  compact = false,
  property,
  roofData,
  layerVisibility,
  onLayerVisibilityChange,
  selectedPanelCount,
  selectedPanel,
  onSelectedPanelIdChange,
}: {
  annualFluxUrl: string | null;
  dsmUrl: string | null;
  solarMaskUrl: string | null;
  solarRgbUrl: string | null;
  viewMode: ViewMode;
  address: string;
  compact?: boolean;
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (next: LayerVisibility) => void;
  selectedPanelCount: number;
  selectedPanel?: SolarPanel | null;
  onSelectedPanelIdChange?: (panelId: string) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlayRefs = useRef<GoogleMapOverlayInstance[]>([]);
  const overlayRunRef = useRef(0);
  const cameraFitTimeoutRef = useRef<number | null>(null);
  const cameraFitKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
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
        mapElementRef.current.replaceChildren();
        mapRef.current = new googleApi.maps.Map(mapElementRef.current, {
          center,
          zoom: cameraTarget.zoom,
          tilt: 0,
          heading: 0,
          mapTypeId: googleApi.maps.MapTypeId.SATELLITE,
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          gestureHandling: "greedy",
          // Clean sales-render frame: no POI clutter over the roof.
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
      }

      if (!mapRef.current) {
        return;
      }

      mapRef.current.setCenter(center);
      mapRef.current.setZoom(cameraTarget.zoom);
      mapRef.current.setTilt(0);
      mapRef.current.setMapTypeId(googleApi.maps.MapTypeId.SATELLITE);
      setMapReady(true);
    };

    void setupMap();

    return () => {
      cancelled = true;
      if (cameraFitTimeoutRef.current !== null) {
        window.clearTimeout(cameraFitTimeoutRef.current);
        cameraFitTimeoutRef.current = null;
      }
      setMapReady(false);
    };
  }, [cameraTarget, cameraTargetKey, center, mapsApiKey]);

  useEffect(() => {
    const mapElement = mapElementRef.current;

    return () => {
      if (cameraFitTimeoutRef.current !== null) {
        window.clearTimeout(cameraFitTimeoutRef.current);
        cameraFitTimeoutRef.current = null;
      }
      clearGoogleOverlays(overlayRefs.current);
      overlayRefs.current = [];
      mapRef.current = null;
      mapElement?.replaceChildren();
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const drawOverlays = async () => {
      if (!mapReady || !mapRef.current || !mapsApiKey) {
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

      if (layerVisibility.roofPlanes) {
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

        // Prefer Solar API segment outlines (aligned with panel placements).
        // DSM-derived planes are a fallback only — they often disagree with
        // Google's panel lattice and make a good layout look "off the roof".
        const solarSegmentOverlays = createRoofSegmentOverlays({
          googleApi,
          map: mapRef.current,
          roofData,
        });
        if (solarSegmentOverlays.length) {
          nextOverlays.push(...solarSegmentOverlays);
        } else if (dsmExtraction?.planes.length) {
          nextOverlays.push(
            ...createDsmPlaneOverlays({
              extraction: dsmExtraction,
              googleApi,
              map: mapRef.current,
            })
          );
        }
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
      }

      if (layerVisibility.sunlight) {
        let addedFluxOverlay = false;
        if (annualFluxUrl) {
          const heatmapOverlay = await createAnnualFluxMapOverlay({
            googleApi,
            annualFluxUrl,
            clipPolygons: getRoofHeatmapClipPolygons(roofData),
            solarMaskUrl,
            fallbackBounds: roofData.roofBounds,
            opacity: 0.6,
          });

          if (heatmapOverlay) {
            if (cancelled || overlayRunRef.current !== overlayRun || !mapRef.current) {
              heatmapOverlay.setMap(null);
              return;
            }

            heatmapOverlay.setMap(mapRef.current);
            nextOverlays.push(heatmapOverlay);
            addedFluxOverlay = true;
          }
        }

        if (!addedFluxOverlay) {
          nextOverlays.push(
            ...createEstimatedSunlightQualityOverlays({
              googleApi,
              map: mapRef.current,
              roofData,
            })
          );
        }
      }

      if (layerVisibility.panels) {
        nextOverlays.push(
          ...createSolarPanelOverlays({
            googleApi,
            map: mapRef.current,
            roofData,
            selectedPanelCount,
          })
        );
      }
      const selectedHomeOverlay = createSelectedHomeOverlay({
        googleApi,
        map: mapRef.current,
        point: getSelectedHomeMarkerPoint({
          property,
          roofData,
        }),
      });
      if (selectedHomeOverlay) {
        nextOverlays.push(selectedHomeOverlay);
      }
      overlayRefs.current = nextOverlays;

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
    layerVisibility,
    mapReady,
    mapsApiKey,
    roofData,
    selectedPanelCount,
    solarMaskUrl,
    property,
    cameraTarget,
    cameraTargetKey,
  ]);

  const showMapFallback = !mapsApiKey || !center;
  const canRenderPanels = roofData.solarPanels.length > 0;
  const panelCapacity = getMaxSelectablePanelCount(roofData);
  const renderedPanelCount = getRenderablePanelCount(roofData, selectedPanelCount);
  const systemKw =
    Math.round(
      (((renderedPanelCount > 0 ? renderedPanelCount : panelCapacity) *
        (selectedPanel?.watts ?? STANDARD_PANEL_WATTS)) /
        1000) *
        10
    ) / 10;
  const mapHeightClass = compact
    ? "min-h-[24rem] lg:min-h-[30rem]"
    : "min-h-[36rem] lg:min-h-[43rem]";

  const is3dView = viewMode === "model3d";

  return (
    <div className="overflow-hidden bg-slate-950">
      <div className={`relative ${mapHeightClass}`}>
        <div ref={mapElementRef} className="absolute inset-0" aria-label={`Satellite roof map for ${address}`} />
        {is3dView ? (
          <RoofScene3D
            dsmUrl={dsmUrl}
            rgbUrl={solarRgbUrl}
            fluxUrl={annualFluxUrl}
            maskUrl={solarMaskUrl}
            roofData={roofData}
            selectedPanelCount={layerVisibility.panels ? selectedPanelCount : 0}
            showSunlight={layerVisibility.sunlight}
          />
        ) : null}
        {is3dView && onSelectedPanelIdChange ? (
          <ModuleDesignPanel
            selectedPanel={selectedPanel}
            selectedPanelCount={
              layerVisibility.panels ? selectedPanelCount : 0
            }
            onSelectedPanelIdChange={onSelectedPanelIdChange}
          />
        ) : null}
        {showMapFallback && !is3dView ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/72 px-6 text-center">
            <p className="max-w-sm text-sm leading-6 text-slate-300">
              Google Maps browser key or roof center is missing. Add
              {" "}
              <span className="font-semibold text-white">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</span>
              {" "}
              and complete the roof lookup to render live map overlays.
            </p>
          </div>
        ) : null}
        {!showMapFallback || is3dView ? (
          <div className="hidden sm:block">
            <LayerControl
              layerVisibility={layerVisibility}
              onLayerVisibilityChange={onLayerVisibilityChange}
              canRenderPanels={canRenderPanels}
              hideRoofPlanes={is3dView}
            />
            {!is3dView ? (
              <MapEvidenceOverlay
                layerVisibility={layerVisibility}
                panelCapacity={panelCapacity}
                renderedPanelCount={renderedPanelCount}
                canRenderPanels={canRenderPanels}
                systemKw={systemKw}
                panelLabel={
                  selectedPanel ? `Panel: ${getShortPanelName(selectedPanel)}` : null
                }
              />
            ) : (
              <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-11rem)] flex-wrap items-center gap-1.5 sm:left-3 sm:top-3">
                <span className="rounded-full border border-white/10 bg-slate-950/58 px-2.5 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-cyan-100/95 backdrop-blur-[2px]">
                  3D roof model · Solar API elevation scan
                </span>
                <span className="rounded-full border border-white/10 bg-slate-950/62 px-2.5 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-white/95 backdrop-blur-[2px]">
                  {renderedPanelCount} panel layout · {systemKw.toFixed(1)} kW
                </span>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {!showMapFallback || is3dView ? (
        <MobileMapControls
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={onLayerVisibilityChange}
          panelCapacity={panelCapacity}
          renderedPanelCount={renderedPanelCount}
          canRenderPanels={canRenderPanels}
          systemKw={systemKw}
          hideRoofPlanes={is3dView}
        />
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
      )}&loading=async&callback=${callbackName}`;
      script.onerror = () => reject(new Error("Google Maps script failed to load."));
      document.head.appendChild(script);
    });
  }

  return browserWindow.__solarMapsPromise;
}

function LayerControl({
  layerVisibility,
  onLayerVisibilityChange,
  canRenderPanels,
  hideRoofPlanes = false,
}: {
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (next: LayerVisibility) => void;
  canRenderPanels: boolean;
  hideRoofPlanes?: boolean;
}) {
  const toggles: Array<{
    id: keyof LayerVisibility;
    label: string;
    disabled?: boolean;
    helper?: string;
  }> = [
    {
      id: "panels",
      label: "Panels",
      helper: canRenderPanels ? undefined : "Estimated capacity view",
    },
    { id: "sunlight", label: "Sunlight quality" },
    // Roof-plane outlines are drawn on the 2D map only.
    ...(hideRoofPlanes
      ? []
      : ([{ id: "roofPlanes", label: "Roof planes" }] as const)),
  ];

  return (
    <div className="pointer-events-auto absolute right-2 top-2 z-20 w-[9.75rem] max-w-[calc(100%-1rem)] rounded-[0.9rem] border border-white/20 bg-slate-950/68 p-2 shadow-[0_10px_24px_rgba(2,8,20,0.24)] backdrop-blur-md sm:right-3 sm:top-3 sm:w-auto">
      <p className="px-1 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-cyan-100/86">
        Layers
      </p>
      <div className="mt-2 grid gap-1.5">
        {toggles.map((toggle) => (
          <label
            key={toggle.id}
            className={`flex items-center justify-between gap-2 rounded-full border border-white/10 px-2.5 py-2 text-[0.68rem] font-semibold ${
              toggle.disabled
                ? "cursor-not-allowed bg-white/[0.025] text-white/38"
                : "cursor-pointer bg-white/[0.05] text-white/86"
            }`}
          >
            <span>{toggle.label}</span>
            <input
              type="checkbox"
              checked={layerVisibility[toggle.id]}
              disabled={toggle.disabled}
              onChange={(event) =>
                onLayerVisibilityChange({
                  ...layerVisibility,
                  [toggle.id]: event.target.checked,
                })
              }
              className="h-4 w-4 shrink-0 accent-cyan-300"
            />
          </label>
        ))}
      </div>
      {toggles.some((toggle) => toggle.helper) ? (
        <p className="mt-2 px-1 text-[0.58rem] leading-4 text-white/58">
          {toggles.find((toggle) => toggle.helper)?.helper}
        </p>
      ) : null}
    </div>
  );
}

function MobileMapControls({
  layerVisibility,
  onLayerVisibilityChange,
  panelCapacity,
  renderedPanelCount,
  canRenderPanels,
  systemKw,
  hideRoofPlanes = false,
}: {
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (next: LayerVisibility) => void;
  panelCapacity: number;
  renderedPanelCount: number;
  canRenderPanels: boolean;
  systemKw: number;
  hideRoofPlanes?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelSummary =
    canRenderPanels && renderedPanelCount > 0
      ? `${renderedPanelCount} panel layout · ${systemKw.toFixed(1)} kW`
      : `Estimated capacity: up to ${panelCapacity} panels · ${systemKw.toFixed(1)} kW`;
  const toggles: Array<{ id: keyof LayerVisibility; label: string }> = [
    { id: "panels", label: "Panels" },
    ...(hideRoofPlanes
      ? []
      : ([{ id: "roofPlanes", label: "Roof planes" }] as const)),
    { id: "sunlight", label: "Sunlight" },
  ];
  const enabledLayers = toggles
    .filter((toggle) => layerVisibility[toggle.id])
    .map((toggle) => toggle.label)
    .join(" / ");

  return (
    <div className="border-t border-white/10 bg-slate-950/96 p-3 sm:hidden">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="mobile-map-controls-panel"
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-left transition hover:bg-white/[0.08]"
      >
        <span className="min-w-0">
          <span className="block text-[0.62rem] font-bold uppercase tracking-[0.16em] text-cyan-200">
            Map controls
          </span>
          <span className="mt-0.5 block truncate text-[0.68rem] text-slate-400">
            {enabledLayers || "All layers hidden"}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 bg-slate-950/55 text-lg leading-none text-white"
        >
          {isOpen ? "-" : "+"}
        </span>
      </button>

      {isOpen ? (
        <div
          id="mobile-map-controls-panel"
          className="mt-3 rounded-2xl border border-white/12 bg-white/[0.035] p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-cyan-200">
                Solar readiness view
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-white">
                {panelSummary}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close map controls"
              onClick={() => setIsOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 bg-slate-950/60 text-lg leading-none text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              X
            </button>
          </div>

          <fieldset className="mt-3">
            <legend className="sr-only">Map layers</legend>
            <div className="flex flex-wrap gap-2">
              {toggles.map((toggle) => (
                <label
                  key={toggle.id}
                  className="flex min-h-11 min-w-[6rem] flex-1 cursor-pointer items-center justify-between gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-[0.68rem] font-semibold text-white/90"
                >
                  <span>{toggle.label}</span>
                  <input
                    type="checkbox"
                    checked={layerVisibility[toggle.id]}
                    onChange={(event) =>
                      onLayerVisibilityChange({
                        ...layerVisibility,
                        [toggle.id]: event.target.checked,
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-cyan-300"
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <div
            className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-white/8 pt-2 text-[0.62rem] leading-4 text-slate-300"
            aria-label="Map legend"
          >
            {layerVisibility.roofPlanes && !hideRoofPlanes ? (
              <>
                <MobileLegendItem
                  swatch="border border-cyan-400 bg-cyan-300/30"
                  label="Usable roof"
                />
                <MobileLegendItem
                  swatch="border border-amber-400/70 bg-amber-300/15"
                  label="Setback"
                />
              </>
            ) : null}
            {layerVisibility.panels ? (
              <MobileLegendItem
                swatch="border border-white bg-blue-500/75"
                label={canRenderPanels ? "Panels (Google Solar API)" : "Capacity only"}
              />
            ) : null}
            {layerVisibility.sunlight ? (
              <MobileLegendItem swatch="bg-emerald-400/80" label="Sunlight quality" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileLegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-[0.15rem] ${swatch}`} />
      <span>{label}</span>
    </span>
  );
}

function MapEvidenceOverlay({
  layerVisibility,
  panelCapacity,
  panelLabel,
  renderedPanelCount,
  canRenderPanels,
  systemKw,
}: {
  layerVisibility: LayerVisibility;
  panelCapacity: number;
  panelLabel?: string | null;
  renderedPanelCount: number;
  canRenderPanels: boolean;
  systemKw: number;
}) {
  const panelBadge =
    canRenderPanels && renderedPanelCount > 0
      ? `${renderedPanelCount} panel layout \u00b7 ${systemKw.toFixed(1)} kW`
      : `Estimated capacity: up to ${panelCapacity} panels \u00b7 ${systemKw.toFixed(1)} kW`;

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-11rem)] flex-wrap items-center gap-1.5 sm:left-3 sm:top-3 sm:max-w-[calc(100%-1.5rem)]">
        <span className="rounded-full border border-white/10 bg-slate-950/58 px-2.5 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-cyan-100/95 shadow-none backdrop-blur-[2px]">
          Google Solar API roof model
        </span>
        <span className="rounded-full border border-white/10 bg-slate-950/62 px-2.5 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-white/95 shadow-none backdrop-blur-[2px]">
          {panelBadge}
        </span>
        {panelLabel ? (
          <span className="hidden rounded-full border border-white/10 bg-slate-950/62 px-2.5 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-white/95 shadow-none backdrop-blur-[2px] sm:inline-flex">
            {panelLabel}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none absolute bottom-8 left-2 z-10 max-w-[min(16rem,calc(100%-1rem))] rounded-[0.85rem] border border-white/30 bg-white/76 p-2.5 text-[0.72rem] font-medium text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-md sm:bottom-3 sm:left-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-900/10 pb-1.5">
          <p className="text-[0.58rem] font-bold uppercase tracking-[0.18em] text-slate-700">
            Legend
          </p>
          <span className="rounded-full bg-cyan-300/65 px-1.5 py-0.5 text-[0.54rem] font-bold uppercase tracking-[0.12em] text-slate-950">
            Solar API
          </span>
        </div>
        <div className="mt-1.5 grid gap-1">
          {layerVisibility.roofPlanes ? (
            <>
              <LegendItem swatch="border border-cyan-500 bg-cyan-300/30" label="Roof plane - usable solar area" />
              <LegendItem swatch="border border-amber-500/70 bg-amber-300/15" label="Setback - required edge buffer" />
              <LegendItem swatch="bg-slate-700/70" label="Unavailable - shaded or obstructed" />
            </>
          ) : null}
          {layerVisibility.sunlight ? (
            <>
              <LegendItem swatch="bg-emerald-400/80" label="Green - strong sunlight" />
              <LegendItem swatch="bg-amber-300/85" label="Yellow - moderate sunlight" />
              <LegendItem swatch="bg-rose-400/80" label="Red - limited sunlight" />
            </>
          ) : null}
          {layerVisibility.panels ? (
            canRenderPanels ? (
              <LegendItem
                swatch="border border-slate-200/80 bg-[linear-gradient(145deg,#1a6f94_0%,#083049_48%,#030f18_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                label="Photovoltaic modules - aligned to rack grid (Solar API)"
              />
            ) : (
              <LegendItem swatch="border border-slate-500 bg-slate-500/30" label="Estimated capacity - no placement data" />
            )
          ) : null}
        </div>
        <p className="mt-2 border-t border-slate-900/10 pt-2 text-[0.68rem] leading-4 text-slate-700">
          Premium module render on Google Solar API positions. Installer verifies final layout.
        </p>
      </div>
    </>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2 leading-4">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-[0.18rem] ${swatch}`} />
      <span>{label}</span>
    </div>
  );
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
  zoom: number;
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
  const boundsLiteral = getGoogleBoundsLiteral(target.bounds);

  if (boundsLiteral && map.fitBounds) {
    map.fitBounds(boundsLiteral, padding);

    return window.setTimeout(() => {
      if (target.center) {
        map.setCenter(target.center);
      }

      const currentZoom = map.getZoom?.();
      const framedZoom = Number.isFinite(currentZoom)
        ? clampNumber(currentZoom ?? target.zoom, target.zoom, 21)
        : target.zoom;
      map.setZoom(framedZoom);
    }, 180);
  }

  if (target.center) {
    map.setCenter(target.center);
  }
  map.setZoom(target.zoom);

  return null;
}

function getMapFitPadding(element: HTMLElement | null) {
  if (!element) {
    return 56;
  }

  return element.clientWidth >= 768 ? 72 : 40;
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
  const buildingPoints = getRoofAnalysisBounds({
    includePanels: false,
    property,
    roofData,
  });
  const segmentPoints = roofData.roofSegments.flatMap((segment) => {
    const outlinePoints = outlineToLatLngPoints(segment.outline, roofData.roofBounds);

    if (outlinePoints.length >= 3) {
      return outlinePoints;
    }

    return boundsToLatLngPoints(segment.bounds);
  });
  const panelPoints = roofData.solarPanels.flatMap((panel) =>
    buildPanelCornerLatLngPoints({
      analysis: roofData,
      panel,
      panels: roofData.solarPanels,
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
      zoom: 20,
    };
  }

  const viewport = getRoofAnalysisViewport({
    fallbackCenter: property,
    points: allPoints,
  });

  return {
    bounds: viewport.bounds,
    center:
      getLatLngCentroid(centroidSource.filter(isValidLatLngPoint)) ??
      viewport.center ??
      getRoofBoundsCenter(roofData.roofBounds),
    zoom: viewport.staticMapZoom,
  };
}

function getRoofAnalysisBounds({
  includePanels,
  property,
  roofData,
}: {
  includePanels: boolean;
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
}) {
  const roofOutlinePoints = outlineToLatLngPoints(
    getVisualRoofOutline(roofData.roofOutline),
    roofData.roofBounds
  );
  const usableOutlinePoints = outlineToLatLngPoints(
    roofData.usableOutline.length >= 3
      ? insetPolygon(roofData.usableOutline, VISUAL_USABLE_INSET_PERCENT * 0.45)
      : roofData.usableOutline,
    roofData.roofBounds
  );
  const usableSegmentPoints = roofData.roofSegments.flatMap((segment) =>
    segment.usable
      ? outlineToLatLngPoints(segment.outline, roofData.roofBounds)
      : []
  );
  const panelPoints = includePanels
    ? roofData.solarPanels.flatMap((panel) =>
        buildPanelCornerLatLngPoints({
          analysis: roofData,
          panel,
          panels: roofData.solarPanels,
        })
      )
    : [];
  const fallbackPoints = roofOutlinePoints.length
    ? []
    : [
        ...boundsToLatLngPoints(roofData.roofBounds),
        ...(property ? [property] : []),
      ];

  return [
    ...roofOutlinePoints,
    ...usableOutlinePoints,
    ...usableSegmentPoints,
    ...panelPoints,
    ...fallbackPoints,
  ].filter(isValidLatLngPoint);
}

function createRoofBoundsOverlay(
  googleApi: GoogleMapsApi,
  bounds: RoofGeoBounds | null,
  map: GoogleMapInstance
) {
  const boundsLiteral = getGoogleBoundsLiteral(bounds);
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
  const path = outlineToLatLngPath(
    googleApi,
    getVisualRoofOutline(roofData.roofOutline),
    roofData.roofBounds
  );

  if (path.length < 3) {
    return null;
  }

  return new googleApi.maps.Polygon({
    clickable: false,
    fillColor: "#22d3ee",
    fillOpacity: 0.02,
    map,
    paths: path,
    strokeColor: "#67e8f9",
    strokeOpacity: 0.55,
    strokeWeight: 1.4,
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
      const path = outlineToLatLngPath(
        googleApi,
        getVisualRoofOutline(segment.outline, VISUAL_SEGMENT_INSET_PERCENT),
        roofData.roofBounds
      );

      if (path.length < 3) {
        return null;
      }

      // Cool tones for the first two planes, warm for the rest — keeps multi-face
      // roofs readable without implying only three segments exist.
      const isPrimary = index === 0;
      const isSecondary = index === 1;

      return new googleApi.maps.Polygon({
        clickable: false,
        // Quiet fills — panels should be the hero, not competing cyan blobs.
        fillColor: isPrimary ? "#38bdf8" : isSecondary ? "#22d3ee" : "#fbbf24",
        fillOpacity: isPrimary ? 0.028 : isSecondary ? 0.02 : 0.016,
        map,
        paths: path,
        strokeColor: isPrimary ? "#bae6fd" : isSecondary ? "#a5f3fc" : "#fde68a",
        strokeOpacity: 0.45,
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
  const path = outlineToLatLngPath(
    googleApi,
    getVisualRoofOutline(roofData.usableOutline, VISUAL_USABLE_INSET_PERCENT),
    roofData.roofBounds
  );

  if (path.length < 3) {
    return null;
  }

  return new googleApi.maps.Polygon({
    clickable: false,
    fillOpacity: 0,
    map,
    paths: path,
    strokeColor: "#fbbf24",
    strokeOpacity: 0.32,
    strokeWeight: 0.8,
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

function createEstimatedSunlightQualityOverlays({
  googleApi,
  map,
  roofData,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
}) {
  const quality = calculateSunlightQuality({
    annualSavings: roofData.annualSavingsUSD,
    annualSunlightHours: roofData.annualSunlightHours,
    coveragePct: Math.min(100, Math.round((roofData.annualKwh / 14_000) * 100)),
    grossRoofAreaM2: roofData.grossRoofAreaM2,
    orientationLabel: formatCompassDirection(roofData.primaryRoofAzimuth),
    panelCount: roofData.panelCount,
    rejectedCandidateCount: roofData.rejectedPanelCandidateCount,
    roofSegments: roofData.roofSegments,
    shadingRisk: roofData.shadingRisk,
    suitabilityScore: roofData.rooftopConfidenceScore,
    systemKw: roofData.systemKw,
    usablePctRoof: roofData.usablePctRoof,
    usableRoofAreaM2: roofData.usableRoofAreaM2,
  });
  const segmentQualities = new Map(
    quality.segments.map((segment) => [
      segment.label.toLowerCase().replace(" plane", ""),
      segment.quality,
    ])
  );

  return roofData.roofSegments
    .map((segment) => {
      const path = outlineToLatLngPath(googleApi, segment.outline, roofData.roofBounds);

      if (path.length < 3) {
        return null;
      }

      const tone =
        segmentQualities.get(segment.label) ?? getRoofQualityLabel(quality.score);
      const colors = getSunlightQualityMapColors(tone);

      return new googleApi.maps.Polygon({
        clickable: false,
        fillColor: colors.fill,
        fillOpacity: colors.fillOpacity,
        map,
        paths: path,
        strokeColor: colors.stroke,
        strokeOpacity: 0.58,
        strokeWeight: 1,
        zIndex: 16,
      });
    })
    .filter((overlay): overlay is GoogleMapOverlayInstance => Boolean(overlay));
}

function getSunlightQualityMapColors(tone: RoofQualityTone) {
  if (tone === "strong") {
    return {
      fill: "#22c55e",
      fillOpacity: 0.22,
      stroke: "#86efac",
    };
  }

  if (tone === "moderate") {
    return {
      fill: "#fbbf24",
      fillOpacity: 0.2,
      stroke: "#fde68a",
    };
  }

  return {
    fill: "#ef4444",
    fillOpacity: 0.18,
    stroke: "#fecdd3",
  };
}

function getRoofHeatmapClipPolygons(roofData: RoofAnalysis) {
  const segmentOutlinePolygons = roofData.roofSegments
    .map((segment) =>
      outlineToLatLngPoints(
        getVisualRoofOutline(segment.outline, VISUAL_SEGMENT_INSET_PERCENT),
        roofData.roofBounds
      )
    )
    .filter((polygon) => polygon.length >= 3);

  if (segmentOutlinePolygons.length) {
    return segmentOutlinePolygons;
  }

  const usablePolygon = outlineToLatLngPoints(
    getVisualRoofOutline(roofData.usableOutline, VISUAL_USABLE_INSET_PERCENT),
    roofData.roofBounds
  );

  if (usablePolygon.length >= 3) {
    return [usablePolygon];
  }

  const segmentBoundsPolygons = roofData.roofSegments
    .map((segment) => boundsToLatLngPoints(segment.bounds))
    .filter((polygon) => polygon.length >= 3);

  if (segmentBoundsPolygons.length) {
    return segmentBoundsPolygons;
  }

  const roofPolygon = outlineToLatLngPoints(
    getVisualRoofOutline(roofData.roofOutline),
    roofData.roofBounds
  );

  return roofPolygon.length >= 3 ? [roofPolygon] : [];
}

function getVisualRoofOutline(
  outline: RoofAnalysis["roofOutline"],
  insetPercent = VISUAL_ROOF_INSET_PERCENT
) {
  return outline.length >= 3 ? insetPolygon(outline, insetPercent) : outline;
}

type PanelLayoutPlacement = {
  displayPath: LatLngPoint[];
  panel: RoofAnalysis["solarPanels"][number];
};

type PixelPoint = { x: number; y: number };

function getRenderablePanelCount(roofData: RoofAnalysis, selectedPanelCount: number) {
  return Math.min(
    Math.max(0, Math.round(selectedPanelCount)),
    roofData.solarPanels.length
  );
}

function buildSelectedPanelPlacements({
  roofData,
  selectedPanelCount,
}: {
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}): PanelLayoutPlacement[] {
  const targetCount = getRenderablePanelCount(roofData, selectedPanelCount);
  const selectedPanels = selectCohesiveSolarPanels({
    panels: roofData.solarPanels,
    targetCount,
    panelWidthMeters: roofData.panelWidthMeters,
    panelHeightMeters: roofData.panelHeightMeters,
  });

  return selectedPanels.flatMap((panel) => {
    if (!isValidLatLngPoint(panel.center)) {
      return [];
    }

    return [
      {
        displayPath: buildPanelPolygonPath({
          fallbackAzimuthDeg: getPanelFallbackAzimuthDeg(roofData, panel),
          insetMeters: SOLAR_PANEL_SEAM_INSET_METERS,
          panel,
          panelHeightMeters: roofData.panelHeightMeters,
          panelWidthMeters: roofData.panelWidthMeters,
          panels: roofData.solarPanels,
        }),
        panel,
      },
    ];
  });
}

/**
 * Photorealistic PV array on satellite imagery.
 *
 * High-DPI canvas OverlayView (not Map polygons) so we can draw:
 * aluminum frame, crystalline glass gradient, multi-cell busbars,
 * specular glare, and soft roof contact shadow — scaled by zoom.
 */
function createSolarPanelOverlays({
  googleApi,
  map,
  roofData,
  selectedPanelCount,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}): GoogleMapOverlayInstance[] {
  const placements = buildSelectedPanelPlacements({
    roofData,
    selectedPanelCount,
  });

  if (!placements.length) {
    return [];
  }

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = "0";
  container.style.height = "0";
  container.style.overflow = "visible";
  container.style.pointerEvents = "none";
  container.style.zIndex = "40";

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.pointerEvents = "none";
  // Crisp edges on retina; slight blend so modules sit into imagery.
  canvas.style.imageRendering = "auto";
  container.appendChild(canvas);

  const overlay = new googleApi.maps.OverlayView();

  overlay.onAdd = function onAdd() {
    // floatPane sits above map polygons so modules always read on top.
    const panes = this.getPanes() as
      | { floatPane?: HTMLElement; overlayLayer?: HTMLElement }
      | null
      | undefined;
    (panes?.floatPane ?? panes?.overlayLayer)?.appendChild(container);
  };

  overlay.draw = function draw() {
    const projection = this.getProjection();
    if (!projection) {
      return;
    }

    const projected: PixelPoint[][] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const placement of placements) {
      const pixels: PixelPoint[] = [];
      for (const corner of placement.displayPath) {
        const pixel = projection.fromLatLngToDivPixel(
          new googleApi.maps.LatLng(corner.lat, corner.lng)
        );
        if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) {
          continue;
        }
        pixels.push({ x: pixel.x, y: pixel.y });
        minX = Math.min(minX, pixel.x);
        minY = Math.min(minY, pixel.y);
        maxX = Math.max(maxX, pixel.x);
        maxY = Math.max(maxY, pixel.y);
      }
      if (pixels.length >= 4) {
        projected.push(pixels.slice(0, 4));
      }
    }

    if (!projected.length || !Number.isFinite(minX) || !Number.isFinite(minY)) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const pad = 14;
    const cssWidth = Math.max(1, maxX - minX + pad * 2);
    const cssHeight = Math.max(1, maxY - minY + pad * 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    container.style.left = `${minX - pad}px`;
    container.style.top = `${minY - pad}px`;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.ceil(cssWidth * dpr);
    canvas.height = Math.ceil(cssHeight * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const originX = minX - pad;
    const originY = minY - pad;

    // Pass 1: contact shadows (under everything).
    for (const quad of projected) {
      const local = toLocalQuad(quad, originX, originY);
      drawModuleShadow(ctx, local);
    }

    // Pass 2: modules front-to-back (stable API order).
    for (const quad of projected) {
      const local = toLocalQuad(quad, originX, originY);
      drawPhotorealModule(ctx, local);
    }
  };

  overlay.onRemove = function onRemove() {
    container.remove();
  };

  overlay.setMap(map);
  return [overlay];
}

function toLocalQuad(quad: PixelPoint[], originX: number, originY: number) {
  return quad.map((point) => ({
    x: point.x - originX,
    y: point.y - originY,
  }));
}

function drawModuleShadow(ctx: CanvasRenderingContext2D, quad: PixelPoint[]) {
  if (quad.length < 4) {
    return;
  }

  const size = averagePanelSpan(quad);
  if (size < 4) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  pathQuad(ctx, offsetQuad(quad, 0.55, 0.9));
  ctx.closePath();
  ctx.shadowColor = "rgba(2, 8, 20, 0.55)";
  ctx.shadowBlur = Math.max(1.2, size * 0.08);
  ctx.shadowOffsetX = size * 0.02;
  ctx.shadowOffsetY = size * 0.04;
  ctx.fillStyle = "rgba(2, 8, 20, 0.28)";
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one module: aluminum frame, monocrystalline cell mosaic, glass glare.
 * Corners ordered [topLeft, topRight, bottomRight, bottomLeft] from geometry.
 */
function drawPhotorealModule(ctx: CanvasRenderingContext2D, frame: PixelPoint[]) {
  if (frame.length < 4) {
    return;
  }

  const size = averagePanelSpan(frame);
  if (size < 3) {
    return;
  }

  const detail = size >= 26 ? "high" : size >= 14 ? "medium" : "low";
  const glassInset = detail === "high" ? 2.05 : detail === "medium" ? 1.35 : 0.9;
  const glass = insetPixelQuad(frame, glassInset);
  const [ftl, ftr, fbr, fbl] = frame;
  const [gtl, gtr, gbr, gbl] = glass;
  if (!ftl || !ftr || !fbr || !fbl || !gtl || !gtr || !gbr || !gbl) {
    return;
  }

  // --- Slim aluminum frame ---
  ctx.save();
  ctx.beginPath();
  pathQuad(ctx, frame);
  ctx.closePath();
  const frameGrad = ctx.createLinearGradient(ftl.x, ftl.y, fbr.x, fbr.y);
  frameGrad.addColorStop(0, "#f4f7fa");
  frameGrad.addColorStop(0.35, "#d0d7e0");
  frameGrad.addColorStop(0.7, "#a8b3c0");
  frameGrad.addColorStop(1, "#7d8a99");
  ctx.fillStyle = frameGrad;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = Math.max(0.55, size * 0.02);
  ctx.stroke();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.4)";
  ctx.lineWidth = Math.max(0.35, size * 0.014);
  ctx.stroke();
  ctx.restore();

  // --- Backplane under cells (near-black mono wafer look) ---
  ctx.save();
  ctx.beginPath();
  pathQuad(ctx, glass);
  ctx.closePath();
  const baseGrad = ctx.createLinearGradient(gtl.x, gtl.y, gbr.x, gbr.y);
  baseGrad.addColorStop(0, "#0a1c2c");
  baseGrad.addColorStop(0.5, "#061018");
  baseGrad.addColorStop(1, "#03080e");
  ctx.fillStyle = baseGrad;
  ctx.globalAlpha = 0.96;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- Individual monocrystalline cells ---
  if (detail !== "low") {
    const cols = detail === "high" ? 6 : 4;
    const rows = detail === "high" ? 4 : 3;
    const gap = detail === "high" ? 0.035 : 0.04;

    ctx.save();
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const u0 = col / cols + gap * 0.5;
        const u1 = (col + 1) / cols - gap * 0.5;
        const v0 = row / rows + gap * 0.5;
        const v1 = (row + 1) / rows - gap * 0.5;
        if (u1 <= u0 || v1 <= v0) {
          continue;
        }

        const cell = bilinearQuad(gtl, gtr, gbr, gbl, u0, v0, u1, v1);
        const [c0, c1, c2, c3] = cell;
        if (!c0 || !c1 || !c2 || !c3) {
          continue;
        }

        // Slight per-cell tonal variation so the array feels manufactured, not flat.
        const tone = 0.92 + ((row * 3 + col * 7) % 5) * 0.015;
        ctx.beginPath();
        pathQuad(ctx, cell);
        ctx.closePath();
        const cellGrad = ctx.createLinearGradient(c0.x, c0.y, c2.x, c2.y);
        cellGrad.addColorStop(0, shadeHex("#0b3a55", tone));
        cellGrad.addColorStop(0.45, shadeHex("#072636", tone));
        cellGrad.addColorStop(1, shadeHex("#04101a", tone));
        ctx.fillStyle = cellGrad;
        ctx.fill();

        // Micro highlight on the upper-left of each cell
        if (detail === "high") {
          ctx.beginPath();
          pathQuad(ctx, [
            c0,
            interpolatePixel(c0, c1, 0.55),
            interpolatePixel(c0, c2, 0.28),
            interpolatePixel(c0, c3, 0.55),
          ]);
          ctx.closePath();
          ctx.fillStyle = "rgba(125, 211, 252, 0.07)";
          ctx.fill();
        }
      }
    }
    ctx.restore();
  } else {
    // Low zoom: single glass fill without cell mosaic cost
    ctx.save();
    ctx.beginPath();
    pathQuad(ctx, glass);
    ctx.closePath();
    const lowGrad = ctx.createLinearGradient(gtl.x, gtl.y, gbr.x, gbr.y);
    lowGrad.addColorStop(0, "#0c3d5c");
    lowGrad.addColorStop(1, "#041018");
    ctx.fillStyle = lowGrad;
    ctx.globalAlpha = 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- Glass sheet sheen over cells ---
  if (detail !== "low") {
    ctx.save();
    ctx.beginPath();
    pathQuad(ctx, glass);
    ctx.clip();
    const minx = Math.min(gtl.x, gtr.x, gbr.x, gbl.x);
    const miny = Math.min(gtl.y, gtr.y, gbr.y, gbl.y);
    const maxx = Math.max(gtl.x, gtr.x, gbr.x, gbl.x);
    const maxy = Math.max(gtl.y, gtr.y, gbr.y, gbl.y);
    const sheen = ctx.createLinearGradient(gbl.x, gbl.y, gtr.x, gtr.y);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.45, "rgba(186,230,253,0.05)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.11)");
    sheen.addColorStop(0.55, "rgba(186,230,253,0.05)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(minx - 2, miny - 2, maxx - minx + 4, maxy - miny + 4);

    // Top specular band
    ctx.beginPath();
    pathQuad(ctx, [
      gtl,
      gtr,
      interpolatePixel(gtr, gbr, 0.18),
      interpolatePixel(gtl, gbl, 0.18),
    ]);
    ctx.closePath();
    const glare = ctx.createLinearGradient(gtl.x, gtl.y, gbl.x, gbl.y);
    glare.addColorStop(0, "rgba(255,255,255,0.28)");
    glare.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glare;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(gtl.x, gtl.y);
    ctx.lineTo(gtr.x, gtr.y);
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = Math.max(0.65, size * 0.028);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  // --- Glass rim ---
  ctx.save();
  ctx.beginPath();
  pathQuad(ctx, glass);
  ctx.closePath();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
}

/** Bilinear sample of a unit square mapped onto the glass quad. */
function bilinearQuad(
  tl: PixelPoint,
  tr: PixelPoint,
  br: PixelPoint,
  bl: PixelPoint,
  u0: number,
  v0: number,
  u1: number,
  v1: number
): PixelPoint[] {
  const sample = (u: number, v: number) => {
    const top = interpolatePixel(tl, tr, u);
    const bottom = interpolatePixel(bl, br, u);
    return interpolatePixel(top, bottom, v);
  };
  return [sample(u0, v0), sample(u1, v0), sample(u1, v1), sample(u0, v1)];
}

function shadeHex(hex: string, tone: number) {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) {
    return hex;
  }
  const r = Math.round(parseInt(raw.slice(0, 2), 16) * tone);
  const g = Math.round(parseInt(raw.slice(2, 4), 16) * tone);
  const b = Math.round(parseInt(raw.slice(4, 6), 16) * tone);
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, value));
}

function pathQuad(ctx: CanvasRenderingContext2D, quad: PixelPoint[]) {
  const first = quad[0];
  if (!first) {
    return;
  }
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < quad.length; i += 1) {
    const point = quad[i];
    if (point) {
      ctx.lineTo(point.x, point.y);
    }
  }
}

function averagePanelSpan(quad: PixelPoint[]) {
  if (quad.length < 2) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    if (!a || !b) {
      continue;
    }
    sum += Math.hypot(b.x - a.x, b.y - a.y);
    count += 1;
  }
  return count ? sum / count : 0;
}

function offsetQuad(quad: PixelPoint[], dx: number, dy: number): PixelPoint[] {
  return quad.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function interpolatePixel(from: PixelPoint, to: PixelPoint, t: number): PixelPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

/** Pull each corner toward the quad centroid by ~pixels for the glass inset. */
function insetPixelQuad(points: PixelPoint[], pixels: number): PixelPoint[] {
  if (points.length < 3 || pixels <= 0) {
    return points;
  }

  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;

  return points.map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const scale = Math.max(0, (length - pixels) / length);
    return {
      x: cx + dx * scale,
      y: cy + dy * scale,
    };
  });
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

function createSelectedHomeOverlay({
  googleApi,
  map,
  point,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  point: LatLngPoint | null;
}) {
  if (!point || !isValidLatLngPoint(point)) {
    return null;
  }

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.pointerEvents = "none";
  container.style.transform = "translate(-50%, -100%)";
  container.style.zIndex = "20";
  container.innerHTML = `
    <div style="
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:4px;
      filter:drop-shadow(0 10px 18px rgba(2,8,20,0.42));
      font-family:Inter, Arial, sans-serif;
    ">
      <div style="
        border:1px solid rgba(255,255,255,0.72);
        border-radius:999px;
        background:rgba(8,13,24,0.76);
        color:#ffffff;
        font-size:10px;
        font-weight:800;
        letter-spacing:0.16em;
        padding:5px 8px;
        text-transform:uppercase;
        white-space:nowrap;
        backdrop-filter:blur(6px);
      ">Selected home</div>
      <div style="
        width:18px;
        height:18px;
        border-radius:999px;
        background:#67e8f9;
        border:3px solid #ffffff;
        box-shadow:0 0 0 5px rgba(103,232,249,0.28);
      "></div>
      <div style="
        width:2px;
        height:22px;
        background:linear-gradient(180deg,#ffffff,rgba(255,255,255,0));
      "></div>
    </div>
  `;

  const overlay = new googleApi.maps.OverlayView();
  overlay.onAdd = function onAdd() {
    this.getPanes()?.overlayLayer?.appendChild(container);
  };
  overlay.draw = function draw() {
    const projection = this.getProjection();
    const pixel = projection.fromLatLngToDivPixel(
      new googleApi.maps.LatLng(point.lat, point.lng)
    );

    if (!pixel) {
      return;
    }

    container.style.left = `${pixel.x}px`;
    container.style.top = `${pixel.y}px`;
  };
  overlay.onRemove = function onRemove() {
    container.remove();
  };
  overlay.setMap(map);

  return overlay;
}

function getSelectedHomeMarkerPoint({
  property,
  roofData,
}: {
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
}) {
  if (roofData.roofBounds) {
    const center = getRoofBoundsCenter(roofData.roofBounds);

    if (center) {
      return offsetLatLngMeters({
        lat: roofData.roofBounds.northeast.lat,
        lng: center.lng,
        eastMeters: 0,
        northMeters: 6,
      });
    }
  }

  const roofCenter = getLatLngCentroid(
    outlineToLatLngPoints(roofData.roofOutline, roofData.roofBounds).filter(
      isValidLatLngPoint
    )
  );

  return roofCenter ?? getRoofBoundsCenter(roofData.roofBounds) ?? property;
}

function getMaxSelectablePanelCount(roofData: RoofAnalysis) {
  return Math.max(1, getMaxPanelCount(roofData));
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

async function createAnnualFluxMapOverlay({
  googleApi,
  annualFluxUrl,
  clipPolygons,
  solarMaskUrl,
  fallbackBounds,
  opacity,
}: {
  googleApi: GoogleMapsApi;
  annualFluxUrl: string | null;
  clipPolygons: LatLngPoint[][];
  solarMaskUrl: string | null;
  fallbackBounds: RoofGeoBounds | null;
  opacity: number;
}) {
  if (!annualFluxUrl) {
    return null;
  }

  const heatmap = await buildAnnualFluxCanvas({
    annualFluxUrl,
    clipPolygons,
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
  clipPolygons,
  solarMaskUrl,
  fallbackBounds,
}: {
  annualFluxUrl: string;
  clipPolygons: LatLngPoint[][];
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
  const heatmapBounds = getGeoTiffBounds(fluxImage, fallbackBounds);

  for (let index = 0; index < fluxRaster.length; index += 1) {
    const value = fluxRaster[index];
    const offset = index * 4;
    const maskValue = maskRaster ? Number(maskRaster[index] ?? 0) : 1;
    const point = rasterIndexToLatLng(index, width, height, heatmapBounds);

    if (
      !Number.isFinite(value) ||
      value <= -9990 ||
      maskValue <= 0 ||
      !isPointInsideAnyPolygon(point, clipPolygons)
    ) {
      pixels[offset + 3] = 0;
      continue;
    }

    const normalized = clamp01((value - low) / range);
    const { r, g, b } = fluxColor(normalized);
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);

  return {
    canvas,
    bounds: heatmapBounds,
  };
}

function rasterIndexToLatLng(
  index: number,
  width: number,
  height: number,
  bounds: RoofGeoBounds
): LatLngPoint {
  const column = index % width;
  const row = Math.floor(index / width);
  const x = (column + 0.5) / width;
  const y = (row + 0.5) / height;

  return {
    lat:
      bounds.northeast.lat -
      (bounds.northeast.lat - bounds.southwest.lat) * y,
    lng:
      bounds.southwest.lng +
      (bounds.northeast.lng - bounds.southwest.lng) * x,
  };
}

function isPointInsideAnyPolygon(
  point: LatLngPoint,
  polygons: LatLngPoint[][]
) {
  if (!polygons.length) {
    return true;
  }

  return polygons.some(
    (polygon) => polygon.length >= 3 && isLatLngPointInPolygon(point, polygon)
  );
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

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
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
    { lat: bounds.southwest.lat, lng: bounds.southwest.lng },
    { lat: bounds.southwest.lat, lng: bounds.northeast.lng },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            Panels: {Math.min(value, safeMax)} of {safeMax}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Starts at a practical bill-offset size. The preliminary ceiling
            includes usable house and garage planes, a three-foot planning
            reserve, and layout spacing. Final capacity still requires installer
            verification.
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
        aria-label="Number of solar panels"
        aria-valuetext={`${Math.min(value, safeMax)} of ${safeMax} panels`}
        className="mt-4 w-full accent-cyan-300"
      />
      <div className="mt-2 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">
        <span>1 panel</span>
        <span>Preliminary max {safeMax}</span>
      </div>
      {!canRenderPanels ? (
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Panel count is estimated from usable roof area - not a verified
          layout. Google Solar did not return individual module coordinates
          for this property, so no panels are drawn on the map.
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
  const displayAddress = formatDisplayAddress(address);

  return (
    <div className="overflow-hidden rounded-[1.15rem] border border-black/10 bg-white/95 text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.18)] backdrop-blur">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[0.64rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
          Preliminary property model
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-700">{displayAddress}</p>
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
          detail="Solar API usable-area model; final setbacks require installer review"
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

function ConfidenceReadouts({ roofData }: { roofData: RoofAnalysis }) {
  const readouts = getVisualizationConfidenceReadouts(roofData);

  return (
    <div className="grid gap-2 rounded-[1rem] border border-white/8 bg-slate-950/34 p-3">
      {readouts.map((readout) => (
        <div
          key={readout.label}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="text-slate-400">{readout.label}</span>
          <span
            className={`rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] ${getConfidenceToneClass(
              readout.level
            )}`}
          >
            {readout.level} · {readout.score}/100
          </span>
        </div>
      ))}
    </div>
  );
}

function getVisualizationConfidenceReadouts(roofData: RoofAnalysis) {
  const roofDetectionScore = clampNumber(
    Math.round(roofData.rooftopConfidenceScore),
    0,
    100
  );
  const solarModelScore = getSolarModelConfidenceScore(roofData);
  const geometryScore = getGeometryConfidenceScore(roofData);

  return [
    {
      label: "Roof Detection Confidence",
      level: getConfidenceLevel(roofDetectionScore),
      score: roofDetectionScore,
    },
    {
      label: "Solar Model Confidence",
      level: getConfidenceLevel(solarModelScore),
      score: solarModelScore,
    },
    {
      label: "Geometry Confidence",
      level: getConfidenceLevel(geometryScore),
      score: geometryScore,
    },
  ];
}

function getSolarModelConfidenceScore(roofData: RoofAnalysis) {
  let score = roofData.source === "solar-api" ? 42 : roofData.source === "vision-api" ? 26 : 14;

  if (roofData.solarPanelConfigs.length) score += 16;
  if (roofData.annualSunlightHours > 0) score += 14;
  if (roofData.roofSegments.length >= 2) score += 10;
  if (roofData.solarPanels.length > 0) score += 10;
  if (roofData.usableRoofAreaM2 > 0) score += 8;

  return clampNumber(Math.round(score), 0, 100);
}

function getGeometryConfidenceScore(roofData: RoofAnalysis) {
  const usableSegmentCount = roofData.roofSegments.filter(
    (segment) =>
      segment.usable &&
      outlineToLatLngPoints(segment.outline, roofData.roofBounds).length >= 3
  ).length;
  const acceptedCount = roofData.acceptedPanelCount ?? roofData.solarPanels.length;
  const expectedCount = Math.max(roofData.panelCount, acceptedCount, 1);
  const acceptedRatio = Math.min(1, acceptedCount / expectedCount);
  let score = 0;

  if (roofData.roofBounds) score += 18;
  if (roofData.roofOutline.length >= 4) score += 16;
  score += Math.min(24, usableSegmentCount * 8);
  score += Math.round(acceptedRatio * 22);
  if (roofData.confidence === "high") score += 14;
  else if (roofData.confidence === "medium") score += 8;
  if (roofData.solarPanels.length > 0) score += 8;

  return clampNumber(Math.round(score), 0, 100);
}

function getConfidenceLevel(score: number) {
  if (score >= 82) return "High";
  if (score >= 64) return "Good";
  if (score >= 45) return "Moderate";
  return "Limited";
}

function getConfidenceToneClass(level: string) {
  if (level === "High" || level === "Good") {
    return "border-emerald-300/18 bg-emerald-300/10 text-emerald-100";
  }

  if (level === "Moderate") {
    return "border-amber-300/18 bg-amber-300/10 text-amber-100";
  }

  return "border-rose-300/18 bg-rose-300/10 text-rose-100";
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
            Solar API roof measurements with the current estimated panel capacity.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-300">
          Solar API
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <MetricRow label="Roof width" source="Solar API" value={`${roofData.widthM.toFixed(1)} m`} />
        <MetricRow label="Roof depth" source="Solar API" value={`${roofData.depthM.toFixed(1)} m`} />
        <MetricRow label="Gross roof area" source="Solar API" value={`${metrics.roofArea.toFixed(1)} sq m`} />
        <MetricRow label="Usable roof area" source="Solar API" value={`${metrics.usableArea.toFixed(1)} sq m`} />
        <MetricRow label="Annual sunlight" source="Solar API" value={`${metrics.annualSunlightHours.toLocaleString()} hrs`} />
        <MetricRow label="Average roof pitch" source="Solar API" value={`${metrics.averageRoofPitch.toFixed(1)} deg`} />
        <MetricRow label="Primary orientation" source="Solar API" value={metrics.orientationLabel} />
        <MetricRow
          label="Selected system"
          source="Recommended"
          value={`${metrics.selectedPanelCount} panels`}
        />
        <MetricRow
          label="Preliminary panel ceiling"
          source="Modeled"
          value={`Up to ${getMaxPanelCount(roofData)} panels`}
        />
        <MetricRow
          label="Raw model positions"
          source="Solar API"
          value={`${getProviderPanelCandidateCount(roofData)} candidates before planning reserves`}
        />
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
              {primarySegment ? `${primarySegment.areaM2.toFixed(1)} sq m` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">Secondary</span>
            <span className="text-white">
              {secondarySegment ? `${secondarySegment.areaM2.toFixed(1)} sq m` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">Garage</span>
            <span className="text-white">
              {roofData.roofSegments[2]
                ? `${roofData.roofSegments[2].areaM2.toFixed(1)} sq m`
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
                {segment.panelsFit} API candidates
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
              <span>{segment.areaM2.toFixed(1)} sq m</span>
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
  return formatCompassDirection(value);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPanelCountBucket(panelCount: number) {
  if (panelCount < 10) return "under_10";
  if (panelCount < 20) return "10_to_19";
  if (panelCount < 30) return "20_to_29";
  return "30_plus";
}
