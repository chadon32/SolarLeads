"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
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
  bounds?: RoofGeoBounds | null;
  message?: string;
};

type SolarDataLayersPayload = {
  annualFluxUrl?: string | null;
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
  const [solarMaskUrl, setSolarMaskUrl] = useState<string | null>(null);
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
          setSolarMaskUrl(dataLayersPayload.maskUrl ?? null);
        } else {
          setAnnualFluxUrl(null);
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
      selectedPanelCount || roofData.panelCount,
      1,
      Math.max(1, roofData.panelCount)
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
                    Analyzing roof with satellite data...
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Waiting for Google Solar API roof geometry, panel coordinates, and annual flux layers.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <AnalysisSidebarSkeleton />
        </div>
      ) : null}

      {stage === "done" && roofData && metrics ? (
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
                  Solar roof model available
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Roof geometry, usable solar area, and financial outputs are tied to the live Google Solar building record returned for this property.
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
                  Turn this roof model into a proposal.
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Save the verified roof geometry, selected panel count, and modeled economics into a homeowner-ready solar report.
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
              body={`The primary roof plane faces ${metrics.orientationLabel} with ${metrics.selectedPanelCount} selected modules across usable roof surfaces. The current analysis marks ${roofData.usablePctRoof}% of the roof as solar-ready with ${roofData.shadingRisk} shading exposure.`}
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
            Roof measurements, annual flux, and panel geometry are projected from the current Solar API building model onto the rooftop image.
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
  solarMaskUrl,
  address,
  property,
  roofData,
  viewMode,
  selectedPanelCount,
}: {
  satelliteImage: string | null;
  annualFluxUrl: string | null;
  solarMaskUrl: string | null;
  address: string;
  property: ResolvedProperty | null;
  roofData: RoofAnalysis;
  viewMode: ViewMode;
  selectedPanelCount: number;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlayRefs = useRef<GoogleMapOverlayInstance[]>([]);
  const overlayRunRef = useRef(0);
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const center = useMemo(
    () => getRoofBoundsCenter(roofData.roofBounds) ?? property,
    [property, roofData.roofBounds]
  );

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

      mapRef.current.setCenter(center);
      mapRef.current.setZoom(19);
      mapRef.current.setTilt(0);
      mapRef.current.setMapTypeId(googleApi.maps.MapTypeId.SATELLITE);
    };

    void setupMap();

    return () => {
      cancelled = true;
    };
  }, [center, mapsApiKey]);

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
      const boundsOverlay = createRoofBoundsOverlay(
        googleApi,
        roofData.roofBounds,
        mapRef.current
      );
      if (boundsOverlay) {
        nextOverlays.push(boundsOverlay);
      }

      nextOverlays.push(
        ...createRoofSegmentOverlays({
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

      if (!cancelled && overlayRunRef.current === overlayRun) {
        overlayRefs.current = nextOverlays;
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
    mapsApiKey,
    roofData,
    selectedPanelCount,
    solarMaskUrl,
    viewMode,
  ]);

  const showMapFallback = !mapsApiKey;

  return (
    <div className="relative min-h-[36rem] overflow-hidden bg-slate-950 lg:min-h-[43rem]">
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

function clearGoogleOverlays(overlays: GoogleMapOverlayInstance[]) {
  overlays.forEach((overlay) => {
    try {
      overlay.setMap(null);
    } catch {
      // Rapid view changes can leave Google-managed overlays already detached.
    }
  });
}

function createRoofBoundsOverlay(
  googleApi: GoogleMapsApi,
  bounds: RoofGeoBounds | null,
  map: GoogleMapInstance
) {
  if (!bounds) {
    return null;
  }

  const rectangle = new googleApi.maps.Rectangle({
    bounds: {
      north: bounds.northeast.lat,
      south: bounds.southwest.lat,
      east: bounds.northeast.lng,
      west: bounds.southwest.lng,
    },
    clickable: false,
    fillOpacity: 0,
    map,
    strokeColor: "#22d3ee",
    strokeOpacity: 0.9,
    strokeWeight: 2,
  });

  return rectangle;
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
      if (!segment.bounds) {
        return null;
      }

      return new googleApi.maps.Rectangle({
        bounds: {
          north: segment.bounds.northeast.lat,
          south: segment.bounds.southwest.lat,
          east: segment.bounds.northeast.lng,
          west: segment.bounds.southwest.lng,
        },
        clickable: false,
        fillColor: index === 0 ? "#38bdf8" : "#fbbf24",
        fillOpacity: index === 0 ? 0.075 : 0.045,
        map,
        strokeColor: index === 0 ? "#e0f2fe" : "#fde68a",
        strokeOpacity: 0.72,
        strokeWeight: 1,
      });
    })
    .filter((overlay): overlay is GoogleMapOverlayInstance => Boolean(overlay));
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
  return roofData.solarPanels
    .slice(0, selectedPanelCount)
    .map((panel) => {
      const segment = roofData.roofSegments[panel.segmentIndex];
      const azimuth = Number.isFinite(panel.azimuthDeg)
        ? panel.azimuthDeg
        : segment?.azimuthDeg ?? roofData.primaryRoofAzimuth;
      const path = buildPanelPath(googleApi, {
        centerLat: panel.center.lat,
        centerLng: panel.center.lng,
        orientation: panel.orientation,
        azimuthDeg: azimuth,
        panelWidthMeters: roofData.panelWidthMeters,
        panelHeightMeters: roofData.panelHeightMeters,
      });

      return new googleApi.maps.Polygon({
        clickable: false,
        fillColor: "#3b82f6",
        fillOpacity: 0.7,
        map,
        paths: path,
        strokeColor: "#ffffff",
        strokeOpacity: 0.92,
        strokeWeight: 1,
      });
    });
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

function buildPanelPath(
  googleApi: GoogleMapsApi,
  params: {
    centerLat: number;
    centerLng: number;
    orientation: "PORTRAIT" | "LANDSCAPE";
    azimuthDeg: number;
    panelWidthMeters: number;
    panelHeightMeters: number;
  }
) {
  const shortSide = Math.min(params.panelWidthMeters, params.panelHeightMeters);
  const longSide = Math.max(params.panelWidthMeters, params.panelHeightMeters);
  const widthMeters = params.orientation === "LANDSCAPE" ? longSide : shortSide;
  const heightMeters = params.orientation === "LANDSCAPE" ? shortSide : longSide;
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const rotation = (params.azimuthDeg * Math.PI) / 180;
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
    const latLng = offsetLatLngMeters({
      lat: params.centerLat,
      lng: params.centerLng,
      eastMeters: rotatedEast,
      northMeters: rotatedNorth,
    });

    return new googleApi.maps.LatLng(latLng.lat, latLng.lng);
  });
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
            Adjust the active module count against the current roof model and economics.
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
          Property analysis
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-700">{address}</p>
      </div>

      <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
        <div className="flex items-center justify-between gap-3">
          <span>Solar suitability summary</span>
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
          Projected 20-year savings using the current panel selection
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
            Live Solar API measurements and the current panel count.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-300">
          Live data
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <MetricRow label="Roof width" value={`${roofData.widthM.toFixed(1)} m`} />
        <MetricRow label="Roof depth" value={`${roofData.depthM.toFixed(1)} m`} />
        <MetricRow label="Gross roof area" value={`${metrics.roofArea.toFixed(1)} m²`} />
        <MetricRow label="Usable roof area" value={`${metrics.usableArea.toFixed(1)} m²`} />
        <MetricRow label="Annual sunlight" value={`${metrics.annualSunlightHours.toLocaleString()} hrs`} />
        <MetricRow label="Average roof pitch" value={`${metrics.averageRoofPitch.toFixed(1)}°`} />
        <MetricRow label="Primary orientation" value={metrics.orientationLabel} />
        <MetricRow label="Panel count" value={`${metrics.selectedPanelCount}`} />
        <MetricRow label="Rooftop score" value={`${roofData.rooftopConfidenceScore}/100`} />
        <MetricRow label="Estimated payback" value={`${metrics.roiYears.toFixed(1)} yrs`} />
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

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-white">{value}</span>
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
        <MetricRow label="Estimated system size" value={`${metrics.selectedSystemKw.toFixed(1)} kW`} />
        <MetricRow label="Monthly savings" value={`$${metrics.monthlySavings.toLocaleString()}`} />
        <MetricRow label="Yearly savings" value={`$${metrics.selectedAnnualSavingsUSD.toLocaleString()}`} />
        <MetricRow label="Estimated payback" value={`${metrics.roiYears.toFixed(1)} yrs`} />
        <MetricRow label="Financing from" value={`$${metrics.financingFrom}/mo`} />
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

