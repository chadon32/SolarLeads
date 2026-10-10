"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import {
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { billOptionsIncluding } from "@/lib/monthly-bill-options";
import { createPortal } from "react-dom";
import { AddressSearch } from "@/components/address-search";
import { AnalysisSequence } from "@/components/analysis-sequence";
import { SampleSolarReport } from "@/components/sample-solar-report";
import type { DetailTab } from "@/components/solar-report-dashboard";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import { normalizeFourfoldAttributionKey } from "@/lib/attribution";
import { faqItems } from "@/lib/faq";
import {
  APP_NAME,
  APP_PRIVACY_COPY,
} from "@/lib/brand";
import {
  DEFAULT_BATTERY_OPTION_ID,
  getBatteryById,
} from "@/lib/batteries";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import type { RoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { buildActiveSolarEstimate, getActiveEstimateMetrics } from "@/lib/active-solar-estimate";
import { calculateSolarReadinessScore } from "@/lib/solar-advisor";
import {
  DEFAULT_SOLAR_PANEL_ID,
  getInverterOption,
  getPanelById,
  type InverterType,
} from "@/lib/solarPanels";

const VIDEO_SRC =
  "/Drone_shot_over_solar_neighborhood_202605281518.mp4";
const VIDEO_LOAD_DELAY_MS = 1_000;
/**
 * First frame of the hero clip (~62 KB). It paints immediately while the full
 * video is deferred, and remains the background for reduced-motion/data-saver
 * visitors who should not download the clip at all.
 */
const VIDEO_POSTER_SRC = "/hero-poster.jpg";

const SolarAnalysis = dynamic(
  () =>
    import("@/components/solar-analysis").then(
      (module) => module.SolarAnalysis
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[24rem] items-center justify-center bg-slate-950 px-6 text-center">
        <p className="text-sm text-slate-300">Preparing rooftop analysis...</p>
      </div>
    ),
  }
);

const SolarReportDashboard = dynamic(
  () =>
    import("@/components/solar-report-dashboard").then(
      (module) => module.SolarReportDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-card border border-sky-200/14 bg-slate-950/78 p-6 text-sm text-slate-300">
        Preparing your report workspace...
      </div>
    ),
  }
);

const LeadCaptureForm = dynamic(
  () =>
    import("@/components/lead-capture-form").then(
      (module) => module.LeadCaptureForm
    ),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="flex min-h-48 items-center justify-center rounded-card border border-white/10 bg-slate-950/80 p-6 text-center text-sm text-slate-300">
        Preparing your report form...
      </div>
    ),
  }
);

type HomeClientProps = {
  initialAddress?: string;
  initialAddBattery?: boolean;
  initialBatteryOption?: string;
  initialInverterType?: InverterType;
  initialLatitude?: number;
  initialLongitude?: number;
  initialMonthlyBill?: number;
  initialPanelCount?: number;
  initialPanelId?: string;
  nativeApp?: boolean;
};

type SavedProgress = {
  address: string;
  annualSavings?: number;
  monthlyBill?: number;
  panelCount?: number;
  savedAt: string;
  addBattery?: boolean;
  batteryOption?: string;
  inverterType?: InverterType;
  latitude?: number;
  longitude?: number;
  selectedPanelId?: string;
  systemKw?: number;
};

const MAX_MONTHLY_BILL = 5_000;
const MONTHLY_BILL_RANGE_MESSAGE =
  `Enter a whole-dollar bill from $1 to $${MAX_MONTHLY_BILL.toLocaleString()}.`;

function getMonthlyBillError(rawValue: string) {
  if (!rawValue.trim()) {
    return "Enter your average monthly bill to personalize the estimate.";
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MONTHLY_BILL) {
    return MONTHLY_BILL_RANGE_MESSAGE;
  }

  return "";
}

function normalizeMonthlyBill(value: unknown, fallback = 200) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(MAX_MONTHLY_BILL, Math.max(1, Math.round(parsed)));
}

function getEstimateHref({
  address,
  addBattery,
  batteryOption,
  inverterType,
  monthlyBill,
  nativeApp,
  panelCount,
  location,
  selectedPanelId,
}: {
  address: string;
  addBattery: boolean;
  batteryOption: string;
  inverterType: InverterType;
  monthlyBill: number;
  nativeApp: boolean;
  panelCount: number;
  location?: { lat: number; lng: number } | null;
  selectedPanelId: string;
}) {
  const params = new URLSearchParams({
    address,
    bill: String(normalizeMonthlyBill(monthlyBill)),
    panel: selectedPanelId,
    inverter: inverterType,
  });

  if (panelCount > 0) {
    params.set("panels", String(Math.floor(panelCount)));
  }

  if (addBattery) {
    params.set("battery", batteryOption);
    params.set("addBattery", "1");
  }

  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }

  if (nativeApp) {
    params.set("app", "ios");
  }

  return `/estimate?${params.toString()}`;
}

export function HomeClient({
  initialAddress = "",
  initialAddBattery = false,
  initialBatteryOption = DEFAULT_BATTERY_OPTION_ID,
  initialInverterType,
  initialLatitude,
  initialLongitude,
  initialMonthlyBill = 200,
  initialPanelCount = 0,
  initialPanelId = DEFAULT_SOLAR_PANEL_ID,
  nativeApp = false,
}: HomeClientProps) {
  const router = useRouter();
  const startingMonthlyBill = normalizeMonthlyBill(initialMonthlyBill);
  const selectedAddress = initialAddress;
  const [solarData, setSolarData] = useState<RoofAnalysis | null>(null);
  const [signedRoofAnalysis, setSignedRoofAnalysis] =
    useState<RoofAnalysis | null>(null);
  const [roofAnalysisProof, setRoofAnalysisProof] =
    useState<RoofAnalysisProof | null>(null);
  const [activePanelCount, setActivePanelCount] = useState(initialPanelCount);
  const [monthlyBill, setMonthlyBill] = useState(startingMonthlyBill);
  const [backgroundControlSlot, setBackgroundControlSlot] = useState<HTMLDivElement | null>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [monthlyBillInput, setMonthlyBillInput] = useState(
    String(startingMonthlyBill)
  );
  const [monthlyBillError, setMonthlyBillError] = useState("");
  const [initialBillValidationComplete, setInitialBillValidationComplete] =
    useState(false);
  const [selectedPanelId, setSelectedPanelId] = useState(initialPanelId);
  const [addBattery, setAddBattery] = useState(initialAddBattery);
  const [batteryOption, setBatteryOption] = useState(initialBatteryOption);
  const [selectedInverterType, setSelectedInverterType] =
    useState<InverterType>(initialInverterType ?? "string");
  const [reportTab, setReportTab] = useState<DetailTab>("overview");
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(null);
  const [showReturnBanner, setShowReturnBanner] = useState(false);
  const [totalEstimateCount, setTotalEstimateCount] = useState<number | null>(
    null
  );
  const selectedLocation = useMemo(
    () =>
      Number.isFinite(initialLatitude) && Number.isFinite(initialLongitude) && initialAddress
        ? {
            address: initialAddress,
            lat: Number(initialLatitude),
            lng: Number(initialLongitude),
          }
        : null,
    [initialAddress, initialLatitude, initialLongitude]
  );
  const roofAnalysis = solarData;
  const hasValidAnalysis = Boolean(solarData?.validSite);
  const heroCompact = Boolean(selectedAddress);
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedBattery = addBattery ? getBatteryById(batteryOption) : null;
  const selectPanel = useCallback(
    (nextPanelId: string) => {
      setSelectedPanelId(nextPanelId);

      if (!solarData?.validSite) {
        return;
      }

      const estimate = buildActiveSolarEstimate({
        analysis: solarData,
        batteryCost: selectedBattery?.cost,
        inverterCostAdderPerWatt:
          getInverterOption(selectedInverterType).costAdderPerWatt,
        monthlyBill,
        selectedPanel: getPanelById(nextPanelId),
        selectedPanelCount: activePanelCount || undefined,
      });

      setActivePanelCount(estimate.panelCount);
    },
    [
      activePanelCount,
      monthlyBill,
      selectedBattery?.cost,
      selectedInverterType,
      solarData,
    ]
  );

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const referralCode = searchParams.get("ref")?.trim();
    const utmId = normalizeFourfoldAttributionKey(searchParams.get("utm_id"));

    try {
      if (referralCode) {
        window.sessionStorage.setItem("referredBy", referralCode.toUpperCase());
      }

      if (utmId) {
        window.sessionStorage.setItem("solartelligenceUtmId", utmId);
      }
    } catch {
      // Referral and attribution are optional and must not affect the estimate workflow.
    }

    let frame = 0;

    try {
      const saved = window.localStorage.getItem("solarProgress");
      if (saved) {
        const parsed = JSON.parse(saved) as SavedProgress;
        const ageHours =
          (Date.now() - new Date(parsed.savedAt).getTime()) / 3_600_000;

        if (ageHours > 48) {
          window.localStorage.removeItem("solarProgress");
        } else if (
          parsed.address &&
          formatDisplayAddress(parsed.address) !== formatDisplayAddress(initialAddress)
        ) {
          frame = window.requestAnimationFrame(() => {
            setSavedProgress(parsed);
            setShowReturnBanner(true);
          });
        }
      }
    } catch {
      window.localStorage.removeItem("solarProgress");
    }

    void fetch("/api/neighborhood", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { totalEstimateCount?: number }) => {
        if (typeof payload.totalEstimateCount === "number") {
          setTotalEstimateCount(payload.totalEstimateCount);
        }
      })
      .catch(() => undefined);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [initialAddress]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const rawBill = new URLSearchParams(window.location.search).get("bill");

      if (rawBill !== null) {
        const error = getMonthlyBillError(rawBill);
        if (error) {
          setMonthlyBillInput(rawBill);
          setMonthlyBillError(error);
        } else {
          setMonthlyBillInput(String(initialMonthlyBill));
          setMonthlyBillError("");
        }
      }

      setInitialBillValidationComplete(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialAddress, initialMonthlyBill]);

  useEffect(() => {
    if (initialInverterType || !solarData?.validSite) {
      return;
    }

    const hours = solarData.annualSunlightHours;
    const frame = window.requestAnimationFrame(() => {
      if (hours > 1800) {
        setSelectedInverterType("string");
      } else if (hours >= 1400) {
        setSelectedInverterType("optimizers");
      } else {
        setSelectedInverterType("microinverters");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialInverterType, solarData?.annualSunlightHours, solarData?.validSite]);

  useEffect(() => {
    if (!solarData?.validSite || activePanelCount > 0) {
      return;
    }

    const estimate = buildActiveSolarEstimate({
      analysis: solarData,
      batteryCost: selectedBattery?.cost,
      inverterCostAdderPerWatt:
        getInverterOption(selectedInverterType).costAdderPerWatt,
      monthlyBill,
      selectedPanel,
    });
    const frame = window.requestAnimationFrame(() => {
      if (estimate.recommendedPanelCount > 0) {
        setActivePanelCount(estimate.recommendedPanelCount);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activePanelCount,
    monthlyBill,
    selectedInverterType,
    selectedBattery?.cost,
    selectedPanel,
    solarData,
  ]);


  const reportMetrics = useMemo(() => {
    if (!solarData?.validSite) {
      return null;
    }

    const estimate = buildActiveSolarEstimate({
      analysis: solarData,
      batteryCost: selectedBattery?.cost,
      inverterCostAdderPerWatt:
        getInverterOption(selectedInverterType).costAdderPerWatt,
      monthlyBill,
      selectedPanel,
      selectedPanelCount: activePanelCount || undefined,
    });

    return {
      annualSavings: estimate.annualSavings,
      panelCount: estimate.panelCount,
      // The same readiness score as the dashboard, saved report and PDF (not roof-model confidence).
      score: calculateSolarReadinessScore(getActiveEstimateMetrics(estimate)),
      systemKw: estimate.systemKw,
    };
  }, [
    activePanelCount,
    monthlyBill,
    selectedBattery?.cost,
    selectedInverterType,
    selectedPanel,
    solarData,
  ]);

  useEffect(() => {
    if (!solarData?.validSite || !selectedAddress || !reportMetrics) {
      return;
    }

    window.localStorage.setItem(
      "solarProgress",
      JSON.stringify({
        address: selectedAddress,
        annualSavings: reportMetrics.annualSavings,
        monthlyBill,
        panelCount: reportMetrics.panelCount,
        savedAt: new Date().toISOString(),
        addBattery,
        batteryOption,
        inverterType: selectedInverterType,
        latitude: selectedLocation?.lat,
        longitude: selectedLocation?.lng,
        selectedPanelId,
        systemKw: reportMetrics.systemKw,
      })
    );
  }, [
    addBattery,
    batteryOption,
    monthlyBill,
    reportMetrics,
    selectedAddress,
    selectedInverterType,
    selectedLocation,
    selectedPanelId,
    solarData?.validSite,
  ]);

  useEffect(() => {
    if (
      !selectedAddress ||
      window.location.pathname !== "/estimate" ||
      !initialBillValidationComplete ||
      monthlyBillError
    ) {
      return;
    }

    const estimateHref = getEstimateHref({
      address: selectedAddress,
      addBattery,
      batteryOption,
      inverterType: selectedInverterType,
      monthlyBill,
      nativeApp,
      panelCount: activePanelCount,
      location: selectedLocation,
      selectedPanelId,
    });
    const currentHref = `${window.location.pathname}${window.location.search}`;

    if (currentHref !== estimateHref) {
      // Keep the internal estimate state refresh-safe without adding a history entry
      // for every bill, panel, or equipment adjustment.
      window.history.replaceState(window.history.state, "", estimateHref);
    }
    const bridge = (window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }).ReactNativeWebView;
    bridge?.postMessage(JSON.stringify({ type: "estimate-navigation", url: estimateHref }));
  }, [
    activePanelCount,
    addBattery,
    batteryOption,
    monthlyBill,
    nativeApp,
    selectedAddress,
    selectedInverterType,
    selectedLocation,
    selectedPanelId,
    initialBillValidationComplete,
    monthlyBillError,
  ]);

  const restoreProgress = () => {
    if (!savedProgress?.address) {
      return;
    }

    setShowReturnBanner(false);
    router.push(
      getEstimateHref({
        address: savedProgress.address,
        addBattery: Boolean(savedProgress.addBattery),
        batteryOption:
          savedProgress.batteryOption ?? DEFAULT_BATTERY_OPTION_ID,
        inverterType: savedProgress.inverterType ?? "string",
        location:
          Number.isFinite(savedProgress.latitude) &&
          Number.isFinite(savedProgress.longitude)
            ? {
                lat: Number(savedProgress.latitude),
                lng: Number(savedProgress.longitude),
              }
            : null,
        monthlyBill: savedProgress.monthlyBill ?? 200,
        nativeApp,
        panelCount: savedProgress.panelCount ?? 0,
        selectedPanelId:
          savedProgress.selectedPanelId ?? DEFAULT_SOLAR_PANEL_ID,
      })
    );
  };

  const dismissReturnBanner = () => {
    window.localStorage.removeItem("solarProgress");
    setShowReturnBanner(false);
  };

  // When the estimate finishes loading, its heading takes focus so keyboard and
  // screen-reader users start at the results, unless they have already moved on.
  useEffect(() => {
    if (!hasValidAnalysis) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    reportHeadingRef.current?.focus({ preventScroll: true });
  }, [hasValidAnalysis]);

  const openSendReportTab = () => {
    setReportTab("send");
    window.requestAnimationFrame(() => {
      document
        .getElementById("report-dashboard")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleNewAddress = () => {
    setReportTab("overview");
    router.push(nativeApp ? "/estimate?app=ios" : "/");
  };

  const openScenarioShare = () => {
    setReportTab("overview");
    trackEvent("scenario_share_opened", { surface: "overview" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const disclosure = document.getElementById("scenario-share-disclosure");
        if (disclosure instanceof HTMLDetailsElement) {
          disclosure.open = true;
        }
        document
          .getElementById("scenario-share")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  };

  const handleAddressSelect = (property: {
    address: string;
    lat?: number;
    lng?: number;
  }) => {
    const displayAddress = formatDisplayAddress(property.address);
    if (!displayAddress) {
      return false;
    }

    if (monthlyBillError) {
      window.requestAnimationFrame(() => {
        const billInput = document.getElementById("monthly-bill-input");
        billInput?.focus();
        billInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return false;
    }

    trackEvent("address_selected");
    router.push(
      getEstimateHref({
        address: displayAddress,
        addBattery,
        batteryOption,
        inverterType: selectedInverterType,
        location:
          Number.isFinite(property.lat) && Number.isFinite(property.lng)
            ? {
                lat: Number(property.lat),
                lng: Number(property.lng),
              }
            : null,
        monthlyBill,
        nativeApp,
        panelCount: 0,
        selectedPanelId,
      })
    );
    return true;
  };

  const applyMonthlyBill = (nextValue: number) => {
    const normalizedBill = normalizeMonthlyBill(nextValue, monthlyBill);
    setMonthlyBill(normalizedBill);
    setMonthlyBillInput(String(normalizedBill));
    setMonthlyBillError("");
  };

  const updateMonthlyBill = (rawValue: string) => {
    setMonthlyBillInput(rawValue);

    const error = getMonthlyBillError(rawValue);
    if (error) {
      setMonthlyBillError(error);
      return;
    }

    applyMonthlyBill(Number(rawValue));
  };

  const showAnalysis = Boolean(
    selectedAddress &&
      initialBillValidationComplete &&
      (!monthlyBillError || hasValidAnalysis)
  );
  const reportCtaHref = hasValidAnalysis
    ? "#report-dashboard"
    : selectedAddress && showAnalysis
      ? "#solar-workspace"
      : "#address-estimate";
  return (
    <main
      className={`relative isolate min-h-screen overflow-x-hidden bg-night text-ink ${
        nativeApp ? "native-app-estimate" : ""
      }`}
      data-native-app={nativeApp ? "ios" : undefined}
    >
      {nativeApp || showAnalysis ? null : <CinematicVideoBackground controlSlot={backgroundControlSlot} />}
      {nativeApp || showAnalysis ? null : (
        <>
          <div className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(circle_at_70%_12%,rgba(242,181,68,0.12),transparent_40%),linear-gradient(90deg,rgba(12,21,34,0.8)_0%,rgba(12,21,34,0.36)_45%,rgba(12,21,34,0.74)_100%)]" />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1] h-1/2 bg-gradient-to-t from-night via-night/60 to-transparent" />
        </>
      )}
      {!nativeApp && showReturnBanner && savedProgress ? (
        <ReturnBanner
          address={savedProgress.address}
          onDismiss={dismissReturnBanner}
          onRestore={restoreProgress}
        />
      ) : null}
      {!nativeApp || !showAnalysis ? (
      <section
        className={`relative z-10 mx-auto flex w-full max-w-7xl flex-col px-5 pt-5 sm:px-7 md:px-10 lg:px-12 ${
          heroCompact ? "pb-4" : "pb-6 sm:pb-10"
        }`}
      >
        <nav className="liquid-glass relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-full px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="flex min-h-11 min-w-0 items-center gap-0 sm:gap-3">
            <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-200/14 text-sky-100 sm:grid">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 truncate text-base font-semibold text-ink">{APP_NAME}</span>
          </Link>

          <div className="hidden items-center gap-6 whitespace-nowrap text-sm font-medium text-ink-muted lg:flex">
            <a className="inline-flex min-h-11 items-center transition-colors hover:text-ink" href="#how-it-works">
              How it works
            </a>
            <a className="inline-flex min-h-11 items-center transition-colors hover:text-ink" href="#faq">
              FAQ
            </a>
            <Link className="inline-flex min-h-11 items-center transition-colors hover:text-ink" href="/solar-guide">
              Solar guide
            </Link>
            <Link className="inline-flex min-h-11 items-center transition-colors hover:text-ink" href="/about">
              About
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <details className="relative lg:hidden">
              <summary
                aria-label="Open site navigation"
                className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-ink"
              >
                Menu
              </summary>
              <div className="absolute right-0 top-14 z-30 grid min-w-48 gap-1 rounded-card border border-ridge bg-dusk p-2 shadow-overlay text-left text-sm text-ink backdrop-blur-xl">
                <a className="flex min-h-11 items-center rounded-card px-3 py-2 hover:bg-white/[0.06]" href="#how-it-works">
                  How it works
                </a>
                <a className="flex min-h-11 items-center rounded-card px-3 py-2 hover:bg-white/[0.06]" href="#faq">
                  FAQ
                </a>
                <Link className="flex min-h-11 items-center rounded-card px-3 py-2 hover:bg-white/[0.06]" href="/solar-guide">
                  Solar guide
                </Link>
                <Link className="flex min-h-11 items-center rounded-card px-3 py-2 hover:bg-white/[0.06]" href="/about">
                  About
                </Link>
              </div>
            </details>
            <a
              href={hasValidAnalysis ? "#report-dashboard" : "#address-estimate"}
              onClick={(event) => {
                if (hasValidAnalysis) {
                  event.preventDefault();
                  openSendReportTab();
                }
              }}
              className="btn btn-primary gap-2 px-4 py-3 sm:px-5"
            >
              <span className="hidden sm:inline">
                {hasValidAnalysis ? "Send my full report" : "Analyze my roof"}
              </span>
              <span className="sm:hidden">{hasValidAnalysis ? "Send report" : "Analyze"}</span>
            </a>
          </div>
        </nav>

        <div className={`flex flex-1 items-center ${heroCompact ? "py-5" : "py-7 sm:py-10 lg:py-14"}`}>
          <div className={`mx-auto text-center ${heroCompact ? "max-w-5xl" : "max-w-4xl"}`}>
            {heroCompact ? (
              <div className="mx-auto mb-4 rounded-card border border-ridge bg-dusk px-4 py-4 text-left sm:px-6 sm:py-5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-dim">
                      {hasValidAnalysis ? "Preliminary solar estimate" : "Building your roof model…"}
                    </p>
                    <h1
                      ref={reportHeadingRef}
                      tabIndex={-1}
                      className="mt-1 line-clamp-2 break-words text-xl font-semibold text-ink outline-none sm:text-2xl md:text-3xl"
                    >
                      {formatDisplayAddress(selectedAddress)}
                    </h1>
                  </div>
                  {hasValidAnalysis ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:shrink-0 lg:justify-end">
                      <button type="button" onClick={openSendReportTab} className="btn btn-primary hidden sm:inline-flex">
                        Send my full report
                      </button>
                      <button
                        type="button"
                        onClick={openScenarioShare}
                        className="btn btn-quiet"
                      >
                        Share estimate
                      </button>
                      <button type="button" onClick={handleNewAddress} className="btn btn-quiet">
                        Try another address
                      </button>
                    </div>
                  ) : null}
                </div>
                {reportMetrics ? (
                  <div className="mt-3 grid gap-4 border-t border-ridge pt-4 md:grid-cols-[1fr_auto] md:items-end md:gap-8">
                    <dl data-testid="report-kpi-grid" className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <ReportMiniMetric label="Solar readiness" value={`${reportMetrics.score}/100`} />
                      <ReportMiniMetric label="Panels" value={`${reportMetrics.panelCount}`} />
                      <ReportMiniMetric label="Annual savings" value={formatMoney(reportMetrics.annualSavings)} highlight />
                      <ReportMiniMetric label="System size" value={`${reportMetrics.systemKw.toFixed(1)} kW`} />
                    </dl>
                    <div className="flex items-center gap-3 md:justify-end">
                      <label htmlFor="estimate-monthly-bill" className="text-sm text-ink-muted">
                        Monthly electric bill
                      </label>
                      <select
                        id="estimate-monthly-bill"
                        value={monthlyBill}
                        onChange={(event) => applyMonthlyBill(Number(event.target.value))}
                        className="field-input w-auto min-w-28 font-semibold"
                      >
                        {billOptionsIncluding(monthlyBill).map((value) => (
                          <option key={value} value={value} className="bg-night">
                            {formatMoney(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
            <div className="liquid-glass mx-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium text-ink-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sun" />
              Free Arizona solar calculator
            </div>

            <h1
              className="font-editorial mt-5 max-w-5xl text-[2.6rem] leading-[0.9] tracking-[-0.05em] text-ink drop-shadow-[0_14px_50px_rgba(0,0,0,0.48)] sm:mt-6 sm:text-5xl md:text-6xl lg:text-7xl"
            >
              See your roof&rsquo;s solar potential in 3D.
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-[0.95rem] leading-6 text-ink-muted sm:mt-5 sm:text-lg sm:leading-7">
              See where panels fit, how much sun your roof gets, and what you could
              save. Free, and an installer contacts you only if you ask.
            </p>
              </>
            )}

            {!hasValidAnalysis ? (
              <>
            <div
              id="address-estimate"
              className={`liquid-glass liquid-glass-unclipped rounded-card p-4 sm:p-5 ${
                heroCompact ? "mt-0" : "mt-5 sm:mt-7"
              }`}
            >
              <label className="mb-4 block rounded-card border border-ridge bg-raised/80 px-4 py-3 text-left">
                <span className="block text-sm font-semibold text-ink">
                  What is your monthly electric bill?
                </span>
                <span className="mt-2 flex items-center gap-3">
                  <span className="text-sm font-semibold text-ink-muted">$</span>
                  <input
                    id="monthly-bill-input"
                    type="number"
                    min={1}
                    max={MAX_MONTHLY_BILL}
                    step={1}
                    value={monthlyBillInput}
                    onChange={(event) => updateMonthlyBill(event.target.value)}
                    placeholder="200"
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-dim"
                    inputMode="numeric"
                    aria-describedby={`monthly-bill-help${monthlyBillError ?" monthly-bill-error" : ""}`}
                    aria-invalid={Boolean(monthlyBillError)}
                  />
                </span>
                <span id="monthly-bill-help" className="mt-1 block text-xs leading-5 text-ink-dim">
                  Enter a whole-dollar average from $1 to $5,000. Used to personalize savings.
                </span>
              </label>
              {monthlyBillError ? (
                <div
                  id="monthly-bill-error"
                  role="alert"
                  className="mb-4 rounded-card border border-amber-200/28 bg-amber-200/10 px-4 py-3 text-left text-sm leading-6 text-amber-100"
                >
                  <p className="font-semibold text-amber-50">Check your monthly bill before continuing.</p>
                  <p>{monthlyBillError}</p>
                </div>
              ) : null}
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={handleAddressSelect}
              />
              {totalEstimateCount && totalEstimateCount >= 10 ? (
                <div className="mt-3 hidden rounded-card border border-emerald-300/12 bg-emerald-300/[0.055] px-4 py-3 text-sm text-emerald-50 sm:block">
                  Join{" "}
                  <span className="font-semibold">
                    {formatNumber(Math.floor(totalEstimateCount / 10) * 10)}+
                  </span>{" "}
                  Arizona homeowners who have requested a solar report through
                  Solartelligence.
                </div>
              ) : null}
              {selectedAddress ? (
                <>
                  <div className="liquid-glass mt-4 rounded-card px-4 py-3 text-sm text-ink-muted">
                    Selected property:{" "}
                    <span className="font-semibold text-ink">
                      {formatDisplayAddress(selectedAddress)}
                    </span>
                  </div>
                  {showAnalysis && !hasValidAnalysis ? (
                    <AnalysisSequence key={selectedAddress} address={selectedAddress} />
                  ) : null}
                </>
              ) : null}
            </div>

            {!heroCompact && !nativeApp ? <SampleSolarReport /> : null}
            {!heroCompact ? (
              <>
            <div className="mt-6 flex justify-center">
              <a href={reportCtaHref} className="btn btn-primary w-full px-6 sm:w-auto">
                Analyze my roof
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
              </>
            ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {showAnalysis ? (
        <section
          id="solar-workspace"
          className={`analysis-section relative z-10 mx-auto w-full min-w-0 max-w-7xl overflow-x-clip ${
            nativeApp
              ? "px-2 pb-5 pt-2"
              : "px-5 pb-8 sm:px-7 md:px-10 lg:px-12"
          }`}
        >
          {monthlyBillError && hasValidAnalysis ? (
            <div
              id="monthly-bill-error"
              role="alert"
              className="mb-4 rounded-card border border-amber-200/28 bg-amber-200/10 px-4 py-3 text-left text-sm leading-6 text-amber-100"
            >
              <p className="font-semibold text-amber-50">Check your monthly bill before continuing.</p>
              <p>
                {monthlyBillError} This model remains based on the last valid bill of {formatMoney(monthlyBill)}.
              </p>
            </div>
          ) : null}
          <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
            <div id="rooftop-analysis" className="w-full min-w-0 max-w-full scroll-mt-24 lg:col-span-12">
              <div className="min-w-0">
                <SolarAnalysis
                  key={selectedAddress}
                  address={selectedAddress}
                  compact
                  location={selectedLocation}
                  monthlyBill={monthlyBill}
                  inverterCostAdderPerWatt={
                    getInverterOption(selectedInverterType).costAdderPerWatt
                  }
                  batteryCost={selectedBattery?.cost}
                  onAnalysisChange={setSolarData}
                  onAnalysisProofChange={setRoofAnalysisProof}
                  onSignedAnalysisChange={setSignedRoofAnalysis}
                  activePanelCount={activePanelCount || null}
                  onActivePanelCountChange={setActivePanelCount}
                  selectedPanel={selectedPanel}
                  onSelectedPanelIdChange={selectPanel}
                />
              </div>
            </div>
            {hasValidAnalysis && roofAnalysis ? (
              <SolarReportDashboard
                activeTab={reportTab}
                address={selectedAddress}
                analysis={roofAnalysis}
                activePanelCount={activePanelCount}
                monthlyBill={monthlyBill}
                onMonthlyBillChange={nativeApp ? applyMonthlyBill : undefined}
                onTabChange={setReportTab}
                selectedInverterType={selectedInverterType}
                selectedPanelId={selectedPanelId}
                addBattery={addBattery}
                batteryOption={batteryOption}
                onSelectedInverterTypeChange={setSelectedInverterType}
                onSelectedPanelIdChange={selectPanel}
                onAddBatteryChange={setAddBattery}
                onBatteryOptionChange={setBatteryOption}
                sendReportContent={
                  <LeadCaptureForm
                    initialAddress={selectedAddress}
                    analysis={solarData}
                    analysisProof={roofAnalysisProof}
                    signedRoofAnalysis={signedRoofAnalysis}
                    activePanelCount={activePanelCount}
                    initialMonthlyBill={monthlyBill}
                    lat={selectedLocation?.lat}
                    lng={selectedLocation?.lng}
                    selectedInverterType={selectedInverterType}
                    selectedPanel={selectedPanel}
                    addBattery={addBattery}
                    selectedBattery={selectedBattery}
                  />
                }
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {nativeApp || hasValidAnalysis ? null : <OptionalTrustSections />}

      {nativeApp ? null : (
      <footer className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center justify-center gap-3 px-5 pb-10 text-center text-sm text-ink-muted sm:px-7 md:px-10 lg:px-12">
        <p className="max-w-2xl text-sm leading-6 text-ink-dim">{APP_PRIVACY_COPY}</p>
        <nav aria-label="Legal information" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/solar-guide">
            Arizona solar guide
          </Link>
          <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/privacy">
            Privacy notice
          </Link>
          <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/terms">
            Estimate terms
          </Link>
          <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/about">
            About
          </Link>
          <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="mailto:reports@solartelligence.com">
            Support
          </a>
        </nav>
        <div ref={setBackgroundControlSlot} />
      </footer>
      )}
    </main>
  );
}

function CinematicVideoBackground({ controlSlot }: { controlSlot: HTMLElement | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const userPausedRef = useRef(false);
  const [userPaused, setUserPaused] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoSourceReady, setVideoSourceReady] = useState(false);

  const cancelFade = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const fadeTo = (targetOpacity: number, duration = 500) => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    cancelFade();
    const startOpacity = Number.parseFloat(video.style.opacity || "0");
    const startTime = window.performance.now();

    const tick = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      video.style.opacity = String(
        startOpacity + (targetOpacity - startOpacity) * eased
      );

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      cancelFade();
      if (restartTimeoutRef.current !== null) {
        window.clearTimeout(restartTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const connection = (
      window.navigator as Navigator & {
        connection?: { saveData?: boolean };
      }
    ).connection;

    if (reducedMotion || connection?.saveData || window.matchMedia("(max-width: 767px)").matches) {
      return;
    }

    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number;
    };
    let idleHandle: number | null = null;
    const delayHandle = window.setTimeout(() => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(
          () => setVideoSourceReady(true),
          { timeout: 1_500 }
        );
        return;
      }

      setVideoSourceReady(true);
    }, VIDEO_LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(delayHandle);
      if (idleHandle !== null) {
        idleWindow.cancelIdleCallback?.(idleHandle);
      }
    };
  }, []);

  const handleLoadedData = () => {
    if (userPausedRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Playback stays off, but the element must still be revealed: opacity
      // only ever rises in `handlePlaying`, so leaving it at 0 here would give
      // reduced-motion visitors a permanently black hero. Showing the poster
      // gives them the still image instead of nothing.
      fadeTo(1);
      return;
    }

    void videoRef.current?.play().catch(() => fadeTo(1));
  };

  const handleVideoError = () => {
    // Keep the poster visible if the deferred media request cannot be decoded.
    setVideoFailed(true);
    fadeTo(1);
  };

  const handlePlaying = () => {
    if (userPausedRef.current) {
      videoRef.current?.pause();
      return;
    }
    fadingOutRef.current = false;
    fadeTo(1);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;

    if (
      !video ||
      userPausedRef.current ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      fadingOutRef.current
    ) {
      return;
    }

    if (video.duration - video.currentTime <= 0.55) {
      fadingOutRef.current = true;
      fadeTo(0);
    }
  };

  const handleEnded = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (userPausedRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }

    cancelFade();
    video.style.opacity = "0";

    if (restartTimeoutRef.current !== null) {
      window.clearTimeout(restartTimeoutRef.current);
    }

    restartTimeoutRef.current = window.setTimeout(() => {
      if (userPausedRef.current) return;
      video.currentTime = 0;
      fadingOutRef.current = false;
      void video.play().then(() => fadeTo(1)).catch(() => undefined);
    }, 100);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    // Keep mobile bandwidth for the address workflow until playback is requested.
    if (!videoSourceReady) {
      setVideoSourceReady(true);
      return;
    }
    const paused = !userPausedRef.current;
    userPausedRef.current = paused;
    setUserPaused(paused);
    cancelFade();
    if (restartTimeoutRef.current !== null) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    video.style.opacity = "1";
    if (paused) {
      video.pause();
    } else {
      fadingOutRef.current = false;
      void video.play().catch(() => {
        userPausedRef.current = true;
        setUserPaused(true);
      });
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-0 overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={videoSourceReady ? VIDEO_SRC : undefined}
        poster={VIDEO_POSTER_SRC}
        muted
        aria-hidden="true"
        playsInline
        preload={videoSourceReady ? "metadata" : "none"}
        onLoadedData={handleLoadedData}
        onError={handleVideoError}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className={`h-full w-full object-cover object-[50%_80%] ${
          videoSourceReady ? "opacity-0" : "opacity-100"
        }`}
      />
    </div>
    {!videoFailed && controlSlot
      ? createPortal(
          <button
            type="button"
            onClick={togglePlayback}
            className={`print-static-ui inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-xs font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200 ${videoSourceReady ? "" : "md:hidden motion-reduce:hidden"}`}
          >
            {!videoSourceReady ? "Play background" : userPaused ? "Resume background" : "Pause background"}
          </button>,
          controlSlot
        )
      : null}
    </>
  );
}

function ReturnBanner({
  address,
  onDismiss,
  onRestore,
}: {
  address: string;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="print-static-ui relative z-[70] mx-4 mt-4 flex max-w-5xl flex-col gap-3 rounded-card border border-sky-200/18 bg-slate-950/92 px-4 py-3 text-sm text-ink backdrop-blur-xl sm:fixed sm:inset-x-4 sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:mt-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-6 text-ink-muted">
        Welcome back. Your estimate for{" "}
        <span className="font-semibold text-ink">
          {formatDisplayAddress(address)}
        </span>{" "}
        is saved.
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="btn btn-primary min-h-11 px-4 py-2 text-xs"
        >
          Continue my estimate
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-xs font-semibold text-ink-muted transition hover:bg-white/[0.1] hover:text-ink"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}

function OptionalTrustSections() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-5 pb-12 pt-6 sm:px-7">
      <div id="how-it-works" className="scroll-mt-24">
        <h2 className="font-editorial text-3xl text-ink md:text-4xl">How it works</h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {howItWorksSteps.map((step, index) => (
            <li key={step.title} className="card">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-full bg-sun text-sm font-bold text-on-sun"
              >
                {index + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-1 text-sm leading-6 text-ink-muted">{step.copy}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm leading-6 text-ink-muted">
          It&rsquo;s a preliminary estimate, not an installation quote. Roof shape and sunlight come from
          Google&rsquo;s Solar data; savings use Arizona utility rates.{" "}
          <Link
            href="/solar-guide"
            className="font-semibold text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink"
          >
            How to read your estimate
          </Link>
        </p>
      </div>

      <FaqSection />
    </section>
  );
}

const howItWorksSteps = [
  {
    title: "Enter your bill and address",
    copy: "Your average monthly electric bill and an Arizona address. No account needed.",
  },
  {
    title: "See your roof in 3D",
    copy: "We model your roof from aerial data, place panels where they fit, and estimate your savings.",
  },
  {
    title: "Get the full report",
    copy: "We email you a PDF. An installer contacts you only if you ask.",
  },
];

function FaqSection() {
  return (
    <div id="faq" className="mt-12 scroll-mt-24">
      <h2 className="font-editorial text-3xl text-ink md:text-4xl">Common questions</h2>
      <div className="mt-5 grid gap-2">
        {faqItems.map((item) => (
          <details key={item.question} className="group rounded-card border border-ridge bg-dusk">
            {/* Padding lives on the summary, not the details wrapper: only the
                summary toggles the disclosure, so padding on the parent looked
                tappable but wasn't, leaving a ~20px target on touch screens. */}
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-semibold text-ink">
              {item.question}
              <span aria-hidden="true" className="text-lg text-sun group-open:hidden">+</span>
              <span aria-hidden="true" className="hidden text-lg text-sun group-open:inline">−</span>
            </summary>
            <p className="px-4 pb-4 text-[0.9375rem] leading-7 text-ink-muted">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

function ReportMiniMetric({
  highlight = false,
  label,
  value,
}: {
  highlight?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-dim">{label}</dt>
      <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${highlight ? "text-sun" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}
