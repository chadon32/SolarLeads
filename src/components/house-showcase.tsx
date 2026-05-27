"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildRoofAnalysis, type RoofAnalysis } from "@/lib/roof-analysis";

type HouseShowcaseProps = {
  selectedAddress?: string;
  analysis?: RoofAnalysis | null;
  location?: {
    lat: number;
    lng: number;
  } | null;
};

type ViewMode = "overview" | "scan" | "detail";

const defaultAnalysis = buildRoofAnalysis({
  address: "Arizona property",
  lat: 33.4942,
  lng: -111.9261,
});

const GOOGLE_MAPS_SCRIPT_ID = "google-maps-3d-api";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<{
          Map3DElement: new (options?: Record<string, unknown>) => HTMLElement & {
            mode?: string;
            mapId?: string;
            flyCameraTo?: (options: {
              endCamera: Record<string, unknown>;
              durationMillis: number;
            }) => void;
            addEventListener: (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | AddEventListenerOptions
            ) => void;
            removeEventListener: (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | EventListenerOptions
            ) => void;
          };
        }>;
      };
    };
  }
}

export function HouseShowcase({
  selectedAddress,
  analysis,
  location,
}: HouseShowcaseProps) {
  const activeAnalysis = analysis ?? defaultAnalysis;
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [sceneLoading, setSceneLoading] = useState(true);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const [sceneMessage, setSceneMessage] = useState("Loading the live property view.");
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapElementRef = useRef<HTMLElement | null>(null);
  const progress = sceneLoading ? 72 : 100;

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer = 0;
    let readyTimer = 0;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
    const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID?.trim();

    const cleanupMap = () => {
      if (mapElementRef.current) {
        mapElementRef.current.remove();
        mapElementRef.current = null;
      }
    };

    if (!mapContainerRef.current || !location) {
      const waitingHandle = window.requestAnimationFrame(() => {
        setSceneLoading(true);
        setShowFallbackHint(false);
        setSceneMessage("Waiting for a resolved property location.");
        cleanupMap();
      });

      return () => window.cancelAnimationFrame(waitingHandle);
    }

    if (!apiKey) {
      const missingKeyHandle = window.requestAnimationFrame(() => {
        setSceneLoading(false);
        setShowFallbackHint(true);
        setSceneMessage(
          "3D maps are unavailable until NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is configured."
        );
        cleanupMap();
      });

      return () => window.cancelAnimationFrame(missingKeyHandle);
    }

    const loadingHandle = window.requestAnimationFrame(() => {
      setSceneLoading(true);
      setShowFallbackHint(false);
      setSceneMessage("Loading the live property view.");
    });

    const initMap = async () => {
      try {
        await loadGoogleMaps3D(apiKey);
        const loader = window.google?.maps?.importLibrary;

        if (!loader) {
          throw new Error("Google Maps 3D library did not initialize.");
        }

        const { Map3DElement } = await loader("maps3d");

        if (cancelled || !mapContainerRef.current) {
          return;
        }

        cleanupMap();

        const baseCamera = getCameraForView(viewMode, location);
        const nextMap = new Map3DElement({
          center: {
            lat: location.lat,
            lng: location.lng,
            altitude: 55,
          },
          range: baseCamera.range,
          tilt: 18,
          heading: 0,
          mode: "SATELLITE",
          gestureHandling: "COOPERATIVE",
          defaultUIDisabled: true,
          mapId: mapId || undefined,
        });

        nextMap.mode = "SATELLITE";
        if (mapId) {
          nextMap.mapId = mapId;
        }
        nextMap.style.width = "100%";
        nextMap.style.height = "100%";
        nextMap.setAttribute(
          "aria-label",
          `3D satellite view of ${selectedAddress ?? "the selected property"}`
        );

        const markReady = () => {
          if (cancelled) return;
          window.clearTimeout(fallbackTimer);
          setSceneLoading(false);
          setShowFallbackHint(false);
          setSceneMessage("Live 3D property view ready.");
        };

        const handleError = () => {
          if (cancelled) return;
          setSceneLoading(false);
          setShowFallbackHint(true);
          setSceneMessage("3D view unavailable for this address - showing the satellite scan below.");
        };

        nextMap.addEventListener("gmp-steadychange", markReady, { once: true });
        nextMap.addEventListener("gmp-error", handleError, { once: true });
        nextMap.addEventListener("gmp-map-id-error", handleError, { once: true });

        mapContainerRef.current.innerHTML = "";
        mapContainerRef.current.append(nextMap);
        mapElementRef.current = nextMap;

        readyTimer = window.setTimeout(() => {
          if (cancelled || !nextMap.flyCameraTo) return;

          const revealCamera = getCameraForView(viewMode, location);
          nextMap.flyCameraTo({
            endCamera: {
              center: {
                lat: location.lat,
                lng: location.lng,
                altitude: 42,
              },
              range: revealCamera.range,
              tilt: revealCamera.tilt,
              heading: revealCamera.heading,
            },
            durationMillis: 2200,
          });
        }, 220);

        fallbackTimer = window.setTimeout(() => {
          if (cancelled) return;
          setShowFallbackHint(true);
          setSceneLoading(false);
          setSceneMessage("3D view unavailable for this address - showing the satellite scan below.");
        }, 3200);
      } catch (error) {
        if (cancelled) return;
        setSceneLoading(false);
        setShowFallbackHint(true);
        setSceneMessage(
          error instanceof Error
            ? error.message
            : "3D view unavailable for this address - showing the satellite scan below."
        );
      }
    };

    void initMap();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(loadingHandle);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(readyTimer);
      cleanupMap();
    };
  }, [location, selectedAddress, viewMode]);

  const summary = useMemo(
    () => [
      {
        label: "Estimated monthly savings",
        value: `$${activeAnalysis.estimatedMonthlySavings.toLocaleString()}`,
      },
      {
        label: "Estimated yearly savings",
        value: `$${activeAnalysis.estimatedAnnualSavings.toLocaleString()}`,
      },
      {
        label: "Usable roof area",
        value: `${activeAnalysis.estimatedUsableSolarAreaSqm.toFixed(1)} sq m`,
      },
      {
        label: "Panel count",
        value: `${activeAnalysis.estimatedPanelCount}`,
      },
    ],
    [activeAnalysis]
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 px-1">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Live 3D property view
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Google photorealistic 3D imagery centered on the selected property, with the live roof estimate layered beside it.
          </p>
        </div>

        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-300 backdrop-blur-md">
          {(["overview", "scan", "detail"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-full px-3 py-2 transition ${
                viewMode === mode
                  ? "bg-white text-slate-950 shadow-[0_14px_30px_rgba(255,255,255,0.12)]"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[1.9rem] border border-white/10 bg-[linear-gradient(180deg,rgba(3,7,15,0.95),rgba(5,10,18,0.98))] shadow-[0_28px_100px_rgba(2,8,20,0.55)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(103,232,249,0.16),transparent_26%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.12),transparent_22%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] [background-size:70px_70px]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(2,8,20,0.72),transparent)]" />

        <div className="relative h-[31rem] overflow-hidden sm:h-[36rem]">
          <div ref={mapContainerRef} className="h-full w-full" />

          <div className="pointer-events-none absolute left-5 top-5 rounded-full border border-white/12 bg-slate-950/72 px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-100 shadow-[0_14px_34px_rgba(2,8,23,0.35)] backdrop-blur-md">
            Google 3D property view
          </div>

          <div className="pointer-events-none absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-3">
            <div className="rounded-[1.2rem] border border-white/10 bg-slate-950/72 px-4 py-3 shadow-[0_18px_50px_rgba(2,8,20,0.38)] backdrop-blur-xl">
              <p className="text-[0.56rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Address
              </p>
              <p className="mt-1 text-sm leading-6 text-white">
                {selectedAddress || "Waiting for a property"}
              </p>
            </div>

            <div className="rounded-[1.2rem] border border-white/10 bg-slate-950/72 px-4 py-3 text-right shadow-[0_18px_50px_rgba(2,8,20,0.38)] backdrop-blur-xl">
              <p className="text-[0.56rem] font-semibold uppercase tracking-[0.34em] text-slate-400">
                Estimated size
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {activeAnalysis.estimatedSystemSizeKw.toFixed(1)} kW system
              </p>
            </div>
          </div>

          {sceneLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35 backdrop-blur-[2px]">
              <div className="w-[18rem] rounded-[1.4rem] border border-white/10 bg-slate-950/80 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.35)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                      Preparing preview
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      {sceneMessage}
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tracking-tight text-white">{progress}%</p>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#38bdf8,#e0f2fe)] transition-[width] duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {showFallbackHint ? (
            <div className="pointer-events-none absolute inset-x-5 bottom-24 rounded-[1rem] border border-amber-400/20 bg-slate-950/72 px-4 py-3 text-sm leading-6 text-amber-200 shadow-[0_18px_50px_rgba(2,8,20,0.35)] backdrop-blur-xl">
              3D view unavailable for this address - showing satellite view below.
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => (
          <div
            key={item.label}
            className="glass-panel rounded-[1.4rem] p-4 shadow-[0_18px_50px_rgba(2,8,20,0.32)]"
          >
            <p className="text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-white">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function getCameraForView(
  viewMode: ViewMode,
  location: { lat: number; lng: number }
) {
  if (viewMode === "detail") {
    return {
      center: { lat: location.lat, lng: location.lng, altitude: 42 },
      range: 240,
      tilt: 74,
      heading: 28,
    };
  }

  if (viewMode === "scan") {
    return {
      center: { lat: location.lat, lng: location.lng, altitude: 48 },
      range: 330,
      tilt: 68,
      heading: -18,
    };
  }

  return {
    center: { lat: location.lat, lng: location.lng, altitude: 58 },
    range: 520,
    tilt: 62,
    heading: -36,
  };
}

async function loadGoogleMaps3D(apiKey: string) {
  if (window.google?.maps?.importLibrary) {
    return;
  }

  const existingScript = document.getElementById(
    GOOGLE_MAPS_SCRIPT_ID
  ) as HTMLScriptElement | null;

  if (existingScript) {
    await waitForGoogleMaps();
    return;
  }

  const script = document.createElement("script");
  script.id = GOOGLE_MAPS_SCRIPT_ID;
  script.async = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    apiKey
  )}&loading=async`;

  document.head.append(script);
  await waitForGoogleMaps();
}

async function waitForGoogleMaps() {
  const startedAt = Date.now();

  while (!window.google?.maps?.importLibrary) {
    if (Date.now() - startedAt > 15_000) {
      throw new Error("Google Maps 3D did not finish loading.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}
