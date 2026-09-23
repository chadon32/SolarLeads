"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  APP_TAGLINE,
} from "@/lib/brand";
import {
  DEFAULT_BATTERY_OPTION_ID,
  getBatteryById,
} from "@/lib/batteries";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import type { RoofAnalysisProof } from "@/lib/roof-analysis-proof";
import { buildActiveSolarEstimate } from "@/lib/active-solar-estimate";
import {
  DEFAULT_SOLAR_PANEL_ID,
  getInverterOption,
  getPanelById,
  getShortPanelName,
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
      <div className="rounded-[1.5rem] border border-cyan-200/14 bg-slate-950/78 p-6 text-sm text-slate-300 shadow-[0_22px_75px_rgba(0,0,0,0.38)]">
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
      <div role="status" className="flex min-h-48 items-center justify-center rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-center text-sm text-slate-300">
        Preparing your report form...
      </div>
    ),
  }
);

const featureCards = [
  {
    title: "Address-driven preview",
    copy: "Choose a real Arizona property and we'll load the roof story that goes with that home.",
  },
  {
    title: "Roof-aware placement",
    copy: "Preview where panels may fit before deciding whether to request installer verification.",
  },
  {
    title: "Fast homeowner estimate",
    copy: "Your roof analysis, panel layout, and savings estimate all stay in one place.",
  },
] as const;

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
  const [showProgressNav, setShowProgressNav] = useState(false);
  const [activeProgressSection, setActiveProgressSection] =
    useState("rooftop-analysis");
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

  useEffect(() => {
    const sectionIds = [
      "rooftop-analysis",
      "panel-selection",
      "financing-calculator",
      "generate-report",
    ];

    const onScroll = () => {
      setShowProgressNav(window.scrollY > 420);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveProgressSection(visible.target.id);
        }
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0.1, 0.25, 0.5] }
    );

    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [hasValidAnalysis, reportTab]);

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
      score: solarData.rooftopConfidenceScore,
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

  const openSendReportTab = () => {
    setReportTab("send");
    window.requestAnimationFrame(() => {
      document
        .getElementById("report-dashboard")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleProgressNavClick = (sectionId: string) => {
    if (sectionId === "panel-selection") {
      setReportTab("panels");
    } else if (sectionId === "financing-calculator") {
      setReportTab("financing");
    } else if (sectionId === "generate-report") {
      setReportTab("send");
    } else {
      setReportTab("overview");
    }

    window.requestAnimationFrame(() => {
      document
        .getElementById(sectionId)
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
      className={`relative isolate min-h-screen overflow-x-hidden bg-black text-white ${
        nativeApp ? "native-app-estimate" : ""
      }`}
      data-native-app={nativeApp ? "ios" : undefined}
    >
      {nativeApp ? null : <CinematicVideoBackground />}
      {nativeApp ? null : (
        <>
          <div className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(circle_at_22%_20%,rgba(103,232,249,0.16),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.34)_45%,rgba(0,0,0,0.72)_100%)]" />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1] h-1/2 bg-gradient-to-t from-black via-black/58 to-transparent" />
        </>
      )}
      {nativeApp ? null : (
        <ProgressNav
          activeSection={activeProgressSection}
          show={showProgressNav && hasValidAnalysis}
          onNavigate={handleProgressNavClick}
        />
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
            <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-200/14 text-cyan-100 shadow-[0_0_34px_rgba(103,232,249,0.22)] sm:grid">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white sm:text-[0.68rem] sm:tracking-[0.34em]">
                {APP_NAME}
              </span>
              <span className="hidden text-xs text-white/52 sm:block">
                {APP_TAGLINE}
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-white/68 lg:flex">
            <a className="transition hover:text-white" href="#how-it-works">
              How It Works
            </a>
            <a className="transition hover:text-white" href="#faq">
              FAQ
            </a>
            <Link className="transition hover:text-white" href="/solar-guide">
              Solar guide
            </Link>
            <a
              className="transition hover:text-white"
              href={hasValidAnalysis ? "#solar-workspace" : "#address-estimate"}
            >
              Analysis
            </a>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <details className="relative lg:hidden">
              <summary
                aria-label="Open site navigation"
                className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white"
              >
                Menu
              </summary>
              <div className="absolute right-0 top-14 z-30 grid min-w-48 gap-1 rounded-[1rem] border border-white/10 bg-slate-950/92 p-2 text-left text-sm text-white shadow-[0_18px_55px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                <a className="flex min-h-11 items-center rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="#how-it-works">
                  How It Works
                </a>
                <a className="flex min-h-11 items-center rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="#faq">
                  FAQ
                </a>
                <Link className="flex min-h-11 items-center rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="/solar-guide">
                  Solar guide
                </Link>
                <a
                  className="flex min-h-11 items-center rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]"
                  href={hasValidAnalysis ? "#solar-workspace" : "#address-estimate"}
                >
                  Analysis
                </a>
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
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100 sm:px-5"
            >
              <span className="hidden sm:inline">
                {hasValidAnalysis ? "Send My Full Report" : "Analyze My Roof"}
              </span>
              <span className="sm:hidden">{hasValidAnalysis ? "Send" : "Analyze"}</span>
            </a>
          </div>
        </nav>

        <div className={`flex flex-1 items-center ${heroCompact ? "py-5" : "py-7 sm:py-10 lg:py-14"}`}>
          <div className={`mx-auto text-center ${heroCompact ? "max-w-5xl" : "max-w-4xl"}`}>
            {heroCompact ? (
              <div className="mx-auto mb-4 grid gap-3 rounded-[1.5rem] border border-cyan-200/12 bg-slate-950/58 px-4 py-4 text-left shadow-[0_18px_60px_rgba(2,8,20,0.36)] backdrop-blur-xl md:grid-cols-[1fr_auto] md:items-center md:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100/82">
                    {hasValidAnalysis ? "Report model ready" : "Generating roof model"}
                  </p>
                  <h1 className="mt-2 line-clamp-2 break-words text-xl font-semibold text-white md:text-2xl">
                    {formatDisplayAddress(selectedAddress)}
                  </h1>
                  <p className="mt-1 text-sm leading-6 text-white/64">
                    {hasValidAnalysis
                      ? "Review the roof workspace below, then send the full PDF report."
                      : "Satellite imagery and Solar API roof data are loading."}
                  </p>
                  {reportMetrics ? (
                    <div
                      data-testid="report-kpi-grid"
                      className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
                    >
                      <ReportMiniMetric label="Solar readiness" value={`${reportMetrics.score}/100`} />
                      <ReportMiniMetric label="Panels" value={`${reportMetrics.panelCount}`} />
                      <ReportMiniMetric label="Annual savings" value={formatMoney(reportMetrics.annualSavings)} />
                      <ReportMiniMetric label="System size" value={`${reportMetrics.systemKw.toFixed(1)} kW`} />
                    </div>
                  ) : null}
                </div>
                {hasValidAnalysis ? (
                  <button
                    type="button"
                    onClick={openSendReportTab}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_45px_rgba(255,255,255,0.14)] transition hover:-translate-y-0.5 hover:bg-cyan-100 md:w-auto"
                  >
                    Send My Full Report
                  </button>
                ) : null}
              </div>
            ) : (
              <>
            <div className="liquid-glass mx-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium text-white/78">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(103,232,249,0.85)]" />
              Free Arizona solar calculator
            </div>

            <h1
              className="mt-5 max-w-5xl text-[2.6rem] leading-[0.9] tracking-[-0.05em] text-white drop-shadow-[0_14px_50px_rgba(0,0,0,0.48)] sm:mt-6 sm:text-5xl md:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-editorial), serif" }}
            >
              See your roof&rsquo;s solar potential{" "}
              <span className="block italic text-white/90">
                in 3D.
              </span>
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-[0.95rem] leading-6 text-white/68 sm:mt-5 sm:text-lg sm:leading-7">
              Enter your Arizona address to explore a preliminary panel layout,
              sunlight, and estimated savings. 3D roof detail depends on available
              data. Free to use, with installer contact only if you request it.
            </p>
              </>
            )}

            {!hasValidAnalysis ? (
              <>
            {!heroCompact && !nativeApp ? <SampleSolarReport /> : null}
            <div
              id="address-estimate"
              className={`liquid-glass liquid-glass-unclipped rounded-[1.75rem] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-5 ${
                heroCompact ? "mt-0" : "mt-5 sm:mt-7"
              }`}
            >
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={handleAddressSelect}
              />
              {totalEstimateCount && totalEstimateCount >= 10 ? (
                <div className="mt-3 hidden rounded-[1.15rem] border border-emerald-300/12 bg-emerald-300/[0.055] px-4 py-3 text-sm text-emerald-50 sm:block">
                  Join{" "}
                  <span className="font-semibold">
                    {formatNumber(Math.floor(totalEstimateCount / 10) * 10)}+
                  </span>{" "}
                  Arizona homeowners who have requested a solar report through
                  Solartelligence.
                </div>
              ) : null}
              <label className="mt-4 block rounded-[1.35rem] border border-white/10 bg-black/18 px-4 py-3 text-left">
                <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-cyan-100/78">
                  What is your monthly electric bill?
                </span>
                <span className="mt-2 flex items-center gap-3">
                  <span className="text-sm font-semibold text-white/70">$</span>
                  <input
                    id="monthly-bill-input"
                    type="number"
                    min={1}
                    max={MAX_MONTHLY_BILL}
                    step={1}
                    value={monthlyBillInput}
                    onChange={(event) => updateMonthlyBill(event.target.value)}
                    placeholder="200"
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-lg font-semibold text-white outline-none placeholder:text-white/35"
                    inputMode="numeric"
                    aria-describedby={`monthly-bill-help${monthlyBillError ? " monthly-bill-error" : ""}`}
                    aria-invalid={Boolean(monthlyBillError)}
                  />
                </span>
                <span id="monthly-bill-help" className="mt-1 block text-xs leading-5 text-white/58">
                  Enter a whole-dollar average from $1 to $5,000. Used to personalize savings.
                </span>
              </label>
              {monthlyBillError ? (
                <div
                  id="monthly-bill-error"
                  role="alert"
                  className="mt-3 rounded-[1.05rem] border border-amber-200/28 bg-amber-200/10 px-4 py-3 text-left text-sm leading-6 text-amber-100"
                >
                  <p className="font-semibold text-amber-50">Check your monthly bill before continuing.</p>
                  <p>{monthlyBillError}</p>
                </div>
              ) : null}
              {selectedAddress ? (
                <>
                  <div className="liquid-glass mt-4 rounded-[1.35rem] px-4 py-3 text-sm text-white/72">
                    Selected property:{" "}
                    <span className="font-semibold text-white">
                      {formatDisplayAddress(selectedAddress)}
                    </span>
                  </div>
                  {showAnalysis && !hasValidAnalysis ? (
                    <AnalysisSequence key={selectedAddress} address={selectedAddress} />
                  ) : null}
                </>
              ) : null}
            </div>

            {!heroCompact ? (
              <>
            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={reportCtaHref}
                className="liquid-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-sm font-semibold text-white shadow-[0_22px_70px_rgba(103,232,249,0.18)] transition hover:-translate-y-0.5 sm:w-auto"
              >
                Analyze My Roof
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            <p className="mt-3 text-center text-xs font-semibold text-amber-200/90 sm:text-sm">
              Check current Arizona incentives and modeled solar savings
            </p>

            <div className="mt-5 hidden flex-wrap justify-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/70 sm:flex">
              {["Free", "No account needed", "Optional installer contact", "Arizona only"].map((pill) => (
                <span key={pill} className="liquid-glass rounded-full px-3 py-2">
                  {pill}
                </span>
              ))}
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
              className="mb-4 rounded-[1.05rem] border border-amber-200/28 bg-amber-200/10 px-4 py-3 text-left text-sm leading-6 text-amber-100"
            >
              <p className="font-semibold text-amber-50">Check your monthly bill before continuing.</p>
              <p>
                {monthlyBillError} This model remains based on the last valid bill of {formatMoney(monthlyBill)}.
              </p>
            </div>
          ) : null}
          {nativeApp ? null : (
          <div className="mb-4 flex flex-col justify-between gap-4 rounded-[1.4rem] border border-white/10 bg-slate-950/62 px-4 py-4 shadow-[0_16px_50px_rgba(2,8,20,0.3)] backdrop-blur-xl sm:px-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100/82">
                {hasValidAnalysis ? "Preliminary roof model ready" : "Solar report loading"}
              </p>
              <h2
                className="mt-2 text-2xl leading-none tracking-[-0.035em] text-white md:text-4xl"
                style={{ fontFamily: "var(--font-editorial), serif" }}
              >
                Roof analysis workspace
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/68">
                {formatDisplayAddress(selectedAddress)}
              </p>
              {hasValidAnalysis ? (
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
                  Panel: {getShortPanelName(selectedPanel)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {hasValidAnalysis ? (
                <button
                  type="button"
                  onClick={openScenarioShare}
                  aria-controls="scenario-share"
                  aria-expanded={reportTab === "overview"}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/[0.1]"
                >
                  Share estimate
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleNewAddress}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/[0.1]"
              >
                Try another address
              </button>
            </div>
          </div>
          )}

          <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
            <div id="rooftop-analysis" className={`${hasValidAnalysis ? "lg:col-span-7" : "lg:col-span-12"} w-full min-w-0 max-w-full scroll-mt-24`}>
              <div
                className={`min-w-0 overflow-hidden border border-cyan-200/14 bg-slate-950/78 shadow-[0_22px_75px_rgba(0,0,0,0.38)] backdrop-blur-xl ${
                  nativeApp
                    ? "rounded-[1.15rem] p-1"
                    : "rounded-[1.5rem] p-2 sm:p-3"
                }`}
              >
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
                onActivePanelCountChange={setActivePanelCount}
                onMonthlyBillChange={applyMonthlyBill}
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

      {nativeApp ? null : <OptionalTrustSections />}

      {nativeApp ? null : (
      <footer className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center justify-center gap-3 px-5 pb-10 text-center text-sm text-white/64 sm:px-7 md:px-10 lg:px-12">
        <div className="liquid-glass inline-flex max-w-3xl items-center gap-3 rounded-full px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-cyan-100" aria-hidden="true" />
          <span>{APP_PRIVACY_COPY}</span>
        </div>
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
          <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="mailto:reports@solartelligence.com">
            Support
          </a>
        </nav>
      </footer>
      )}
    </main>
  );
}

function CinematicVideoBackground() {
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
        className={`h-full w-full translate-y-[17%] object-cover ${
          videoSourceReady ? "opacity-0" : "opacity-100"
        }`}
      />
    </div>
    {!videoFailed ? (
      <button
        type="button"
        onClick={togglePlayback}
        className={`print-static-ui fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-40 min-h-11 rounded-full border border-white/20 bg-slate-950/95 px-4 py-2 text-xs font-semibold text-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${videoSourceReady ? "" : "md:hidden motion-reduce:hidden"}`}
      >
        {!videoSourceReady ? "Play background" : userPaused ? "Resume background" : "Pause background"}
      </button>
    ) : null}
    </>
  );
}

function ProgressNav({
  activeSection,
  onNavigate,
  show,
}: {
  activeSection: string;
  onNavigate: (sectionId: string) => void;
  show: boolean;
}) {
  const items = [
    { id: "rooftop-analysis", label: "Roof Analysis" },
    { id: "panel-selection", label: "Panel Selection" },
    { id: "financing-calculator", label: "Financing" },
    { id: "generate-report", label: "Get Report" },
  ];

  return (
    <div
      // Safe-area padding keeps this bar clear of the Dynamic Island in the iOS
      // app: it is `fixed`, so the safe-area padding on #main-content does not
      // reach it.
      inert={!show}
      aria-hidden={!show}
      className={`print-static-ui fixed inset-x-0 top-0 z-50 hidden border-b border-white/10 bg-slate-950/88 px-5 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_14px_42px_rgba(0,0,0,0.26)] backdrop-blur-xl transition-opacity duration-300 md:block ${
        show ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`rounded-full px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] transition ${
              activeSection === item.id
                ? "bg-[#a5f3fc] text-[#07111d]"
                : "bg-white/[0.055] text-white/62 hover:bg-white/[0.1] hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
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
    <div className="print-static-ui relative z-[70] mx-4 mt-4 flex max-w-5xl flex-col gap-3 rounded-[1.3rem] border border-cyan-200/18 bg-slate-950/92 px-4 py-3 text-sm text-white shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:fixed sm:inset-x-4 sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:mt-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-6 text-white/72">
        Welcome back. Your estimate for{" "}
        <span className="font-semibold text-white">
          {formatDisplayAddress(address)}
        </span>{" "}
        is saved.
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="min-h-11 rounded-full bg-cyan-200 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-white"
        >
          Continue my estimate
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.1] hover:text-white"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SectionIntro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  const displayTitle =
    eyebrow === "Generate report"
      ? "Send your full solar report."
      : title;
  const displayCopy =
    eyebrow === "Generate report"
      ? "Enter your details once and we will email the full PDF report for this roof model."
      : copy;

  return (
    <div className="mx-auto max-w-4xl text-center">
      <span className="liquid-glass inline-flex rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
        {eyebrow}
      </span>
      <h2
        className="mt-4 text-3xl leading-[0.98] tracking-[-0.04em] text-white md:text-5xl"
        style={{ fontFamily: "var(--font-editorial), serif" }}
      >
        {displayTitle}
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-white/62 sm:text-base">
        {displayCopy}
      </p>
    </div>
  );
}

function OptionalTrustSections() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-8 sm:px-7 md:px-10 lg:px-12">
      <div className="liquid-glass rounded-[1.5rem] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-5">
        <div id="how-it-works" className="border-b border-white/10 pb-5">
          <div className="rounded-[1rem] px-2 py-3 text-left sm:px-3">
            <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
              Why it works
            </span>
            <h2 className="mt-2 block text-xl font-semibold text-white">
              What your Arizona solar estimate includes
            </h2>
          </div>
          <div className="grid gap-3 px-2 pt-2 sm:px-3 lg:grid-cols-3">
            {featureCards.map((card) => (
              <FeatureCard key={card.title} title={card.title} copy={card.copy} />
            ))}
          </div>
        </div>

        <TrustIndicatorRow />

        <div className="mx-2 mt-5 rounded-[1rem] border border-cyan-200/15 bg-slate-950/65 p-4 text-sm leading-6 text-slate-300 sm:mx-3">
          <p>
            Solartelligence provides preliminary analysis, not an installation
            quote or engineering plan. Start with your address and average monthly
            bill, compare the available panel and financing scenarios, then request
            an emailed report. Installer follow-up is a separate, optional choice.
          </p>
          <Link href="/solar-guide" className="mt-2 inline-flex min-h-11 items-center font-semibold text-cyan-100 underline decoration-cyan-200/40 underline-offset-4 hover:text-white">
            How to read your roof and savings estimate
          </Link>
        </div>

        <FaqSection />
      </div>
    </section>
  );
}

function TrustIndicatorRow() {
  return (
    <div className="mx-2 mt-5 flex flex-wrap items-center justify-center gap-3 rounded-[1rem] border border-white/8 bg-white/[0.04] px-4 py-3 text-xs font-semibold text-white/62 sm:mx-3">
      <span>Roof data via</span>
      <span className="rounded-full border border-cyan-200/18 bg-cyan-300/10 px-3 py-1 text-cyan-100">
        Google Solar API
      </span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>SSL secured</span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>Installer contact is optional</span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>Preliminary estimates</span>
    </div>
  );
}

function FaqSection() {
  return (
    <div
      id="faq"
      className="mx-2 mt-5 scroll-mt-24 rounded-[1.15rem] border border-white/8 bg-slate-950/40 p-3 sm:mx-3"
    >
      <div className="px-2 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
          Common questions
        </h2>
      </div>
      <div className="grid gap-2">
        {faqItems.map((item) => (
          <details
            key={item.question}
            className="group rounded-[0.95rem] border border-white/8 bg-white/[0.035]"
          >
            {/* Padding lives on the summary, not the details wrapper: only the
                summary toggles the disclosure, so padding on the parent looked
                tappable but wasn't, leaving a ~20px target on touch screens. */}
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white">
              {item.question}
              <span className="text-cyan-100 group-open:hidden">+</span>
              <span className="hidden text-cyan-100 group-open:inline">-</span>
            </summary>
            <p className="px-4 pb-3 text-sm leading-6 text-white/66">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

function ReportMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.85rem] border border-white/10 bg-black/28 px-3 py-2">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/55">
        {label}
      </p>
      <p className="mt-1 font-semibold text-white">{value}</p>
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

function FeatureCard({ title, copy }: { title: string; copy: string }) {
  return (
    <article className="liquid-glass h-full rounded-[1.35rem] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)]">
      <div className="mb-5 h-px w-20 bg-gradient-to-r from-cyan-200/80 to-transparent" />
      <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-white/62">{copy}</p>
    </article>
  );
}
