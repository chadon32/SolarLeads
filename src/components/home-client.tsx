"use client";

import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddressSearch } from "@/components/address-search";
import { AnalysisSequence } from "@/components/analysis-sequence";
import { LeadCaptureForm } from "@/components/lead-capture-form";
import { SolarAnalysis } from "@/components/solar-analysis";
import { SolarReportDashboard, type DetailTab } from "@/components/solar-report-dashboard";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
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
import { buildSolarMetrics } from "@/lib/solar-metrics";
import {
  DEFAULT_SOLAR_PANEL_ID,
  getInverterOption,
  getPanelById,
  getPanelFit,
  getShortPanelName,
  type InverterType,
} from "@/lib/solarPanels";

const VIDEO_SRC =
  "/Drone_shot_over_solar_neighborhood_202605281518.mp4";

const featureCards = [
  {
    title: "Address-driven preview",
    copy: "Choose a real Arizona property and we'll load the roof story that goes with that home.",
  },
  {
    title: "Roof-aware placement",
    copy: "See exactly where panels go on your roof before anyone calls, visits, or pressures you.",
  },
  {
    title: "Fast homeowner estimate",
    copy: "Your roof analysis, panel layout, and savings estimate all stay in one place.",
  },
] as const;

const testimonials = [
  {
    name: "Mike T., Chandler AZ",
    quote:
      "I saw exactly where panels would go on my roof before anyone knocked on my door. Made the whole process feel way less pushy.",
  },
  {
    name: "Sandra R., Scottsdale AZ",
    quote:
      "The estimate was within $200 of what we actually got quoted. Really impressed.",
  },
  {
    name: "James K., Mesa AZ",
    quote:
      "No spam after I submitted. Got my report, reviewed it, and called them when I was ready.",
  },
] as const;

type HomeClientProps = {
  initialAddress?: string;
};

type SavedProgress = {
  address: string;
  annualSavings?: number;
  monthlyBill?: number;
  panelCount?: number;
  savedAt: string;
  selectedPanelId?: string;
  systemKw?: number;
};

type NeighborhoodData = {
  rate: number;
  solarHomes: number;
  totalEstimateCount?: number;
  zip: string;
};

export function HomeClient({ initialAddress = "" }: HomeClientProps) {
  const [selectedAddress, setSelectedAddress] = useState(initialAddress);
  const [solarData, setSolarData] = useState<RoofAnalysis | null>(null);
  const [activePanelCount, setActivePanelCount] = useState(0);
  const [monthlyBill, setMonthlyBill] = useState(200);
  const [selectedPanelId, setSelectedPanelId] = useState(DEFAULT_SOLAR_PANEL_ID);
  const [addBattery, setAddBattery] = useState(false);
  const [batteryOption, setBatteryOption] = useState(DEFAULT_BATTERY_OPTION_ID);
  const [selectedInverterType, setSelectedInverterType] =
    useState<InverterType>("string");
  const [reportTab, setReportTab] = useState<DetailTab>("overview");
  const [shareStatus, setShareStatus] = useState("");
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(null);
  const [showReturnBanner, setShowReturnBanner] = useState(false);
  const [neighborhoodData, setNeighborhoodData] =
    useState<NeighborhoodData | null>(null);
  const [totalEstimateCount, setTotalEstimateCount] = useState<number | null>(
    null
  );
  const [showProgressNav, setShowProgressNav] = useState(false);
  const [activeProgressSection, setActiveProgressSection] =
    useState("rooftop-analysis");
  const [selectedLocation, setSelectedLocation] = useState<{
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const roofAnalysis = solarData;
  const hasValidAnalysis = Boolean(solarData?.validSite);
  const heroCompact = Boolean(selectedAddress);
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedBattery = addBattery ? getBatteryById(batteryOption) : null;

  useEffect(() => {
    const referralCode = new URLSearchParams(window.location.search)
      .get("ref")
      ?.trim();

    if (referralCode) {
      window.sessionStorage.setItem("referredBy", referralCode.toUpperCase());
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
    const zip = extractArizonaZip(selectedAddress);

    if (!zip) {
      const frame = window.requestAnimationFrame(() => setNeighborhoodData(null));
      return () => window.cancelAnimationFrame(frame);
    }

    let cancelled = false;

    void fetch(`/api/neighborhood?zip=${encodeURIComponent(zip)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((payload: NeighborhoodData) => {
        if (!cancelled && payload?.zip) {
          setNeighborhoodData(payload);
          if (typeof payload.totalEstimateCount === "number") {
            setTotalEstimateCount(payload.totalEstimateCount);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedAddress]);

  useEffect(() => {
    if (!solarData?.validSite) {
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
  }, [solarData?.annualSunlightHours, solarData?.validSite]);

  useEffect(() => {
    if (!solarData?.validSite || activePanelCount > 0) {
      return;
    }

    const maxPanelCount = buildSolarMetrics(solarData).maxPanelCount;
    const frame = window.requestAnimationFrame(() => {
      if (maxPanelCount > 0) {
        setActivePanelCount(maxPanelCount);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePanelCount, solarData]);

  useEffect(() => {
    if (!shareStatus) {
      return;
    }

    const timer = window.setTimeout(() => setShareStatus(""), 2000);
    return () => window.clearTimeout(timer);
  }, [shareStatus]);

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

    const baseMetrics = buildSolarMetrics(solarData, {
      monthlyBill,
      selectedPanelCount: activePanelCount || undefined,
    });
    const livePanelCount = activePanelCount || baseMetrics.panelCount;
    const selectedFit = getPanelFit(selectedPanel, {
      roofData: solarData,
      monthlyBill,
      selectedPanelCount: livePanelCount,
      inverterCostAdderPerWatt: getInverterOption(selectedInverterType).costAdderPerWatt,
    });

    return {
      annualSavings: selectedFit.annualSavings || baseMetrics.annualSavings,
      panelCount: livePanelCount,
      score: solarData.rooftopConfidenceScore,
      systemKw: selectedFit.systemKw || baseMetrics.systemKw,
    };
  }, [activePanelCount, monthlyBill, selectedInverterType, selectedPanel, solarData]);

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
        selectedPanelId,
        systemKw: reportMetrics.systemKw,
      })
    );
  }, [
    monthlyBill,
    reportMetrics,
    selectedAddress,
    selectedPanelId,
    solarData?.validSite,
  ]);

  const restoreProgress = () => {
    if (!savedProgress?.address) {
      return;
    }

    setSelectedAddress(savedProgress.address);
    setSelectedLocation(null);
    setSolarData(null);
    setMonthlyBill(savedProgress.monthlyBill || 200);
    setActivePanelCount(savedProgress.panelCount || 0);
    setSelectedPanelId(savedProgress.selectedPanelId || DEFAULT_SOLAR_PANEL_ID);
    setShowReturnBanner(false);

    window.requestAnimationFrame(() => {
      document
        .getElementById("rooftop-analysis")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  const showAnalysis = Boolean(selectedAddress);
  const reportCtaHref = hasValidAnalysis
    ? "#report-dashboard"
    : selectedAddress
      ? "#solar-workspace"
      : "#address-estimate";
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-black text-white">
      <CinematicVideoBackground />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(circle_at_22%_20%,rgba(103,232,249,0.16),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.34)_45%,rgba(0,0,0,0.72)_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1] h-1/2 bg-gradient-to-t from-black via-black/58 to-transparent" />
      <ProgressNav
        activeSection={activeProgressSection}
        show={showProgressNav && hasValidAnalysis}
        onNavigate={handleProgressNavClick}
      />
      {showReturnBanner && savedProgress ? (
        <ReturnBanner
          address={savedProgress.address}
          onDismiss={dismissReturnBanner}
          onRestore={restoreProgress}
        />
      ) : null}
      {shareStatus ? (
        <div className="fixed right-5 top-20 z-[60] hidden rounded-full border border-emerald-200/20 bg-emerald-400/18 px-4 py-2 text-sm font-semibold text-emerald-50 shadow-[0_18px_45px_rgba(6,95,70,0.28)] backdrop-blur-xl md:block">
          {shareStatus}
        </div>
      ) : null}

      <section
        className={`relative z-10 mx-auto flex w-full max-w-7xl flex-col px-5 pt-5 sm:px-7 md:px-10 lg:px-12 ${
          heroCompact ? "pb-4" : "pb-10"
        }`}
      >
        <nav className="liquid-glass relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-full px-4 py-3 sm:px-6 sm:py-4">
          <a href="#" className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-200/14 text-cyan-100 shadow-[0_0_34px_rgba(103,232,249,0.22)]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.34em] text-white">
                {APP_NAME}
              </span>
              <span className="hidden text-xs text-white/52 sm:block">
                {APP_TAGLINE}
              </span>
            </span>
          </a>

          <div className="hidden items-center gap-7 text-sm font-medium text-white/68 lg:flex">
            <a className="transition hover:text-white" href="#how-it-works">
              How It Works
            </a>
            <a className="transition hover:text-white" href="#reviews">
              Reviews
            </a>
            <a className="transition hover:text-white" href="#solar-workspace">
              Analysis
            </a>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <details className="relative lg:hidden">
              <summary className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white">
                Menu
              </summary>
              <div className="absolute right-0 top-14 z-30 grid min-w-48 gap-1 rounded-[1rem] border border-white/10 bg-slate-950/92 p-2 text-left text-sm text-white shadow-[0_18px_55px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                <a className="rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="#how-it-works">
                  How It Works
                </a>
                <a className="rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="#reviews">
                  Reviews
                </a>
                <a className="rounded-[0.8rem] px-3 py-2 hover:bg-white/[0.06]" href="#solar-workspace">
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

        <div className={`flex flex-1 items-center ${heroCompact ? "py-5" : "py-10 lg:py-14"}`}>
          <div className={`mx-auto text-center ${heroCompact ? "max-w-5xl" : "max-w-4xl"}`}>
            {heroCompact ? (
              <div className="mx-auto mb-4 grid gap-3 rounded-[1.5rem] border border-cyan-200/12 bg-slate-950/58 px-4 py-4 text-left shadow-[0_18px_60px_rgba(2,8,20,0.36)] backdrop-blur-xl md:grid-cols-[1fr_auto] md:items-center md:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100/82">
                    {hasValidAnalysis ? "Report model ready" : "Generating roof model"}
                  </p>
                  <h1 className="mt-2 truncate text-xl font-semibold text-white md:text-2xl">
                    {formatDisplayAddress(selectedAddress)}
                  </h1>
                  <p className="mt-1 text-sm leading-6 text-white/64">
                    {hasValidAnalysis
                      ? "Review the roof workspace below, then send the full PDF report."
                      : "Satellite imagery and Solar API roof data are loading."}
                  </p>
                  {reportMetrics ? (
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                      <ReportMiniMetric label="Score" value={`${reportMetrics.score}/100`} />
                      <ReportMiniMetric label="Panels" value={`${reportMetrics.panelCount}`} />
                      <ReportMiniMetric label="Savings" value={formatMoney(reportMetrics.annualSavings)} />
                      <ReportMiniMetric label="System" value={`${reportMetrics.systemKw.toFixed(1)} kW`} />
                    </div>
                  ) : null}
                </div>
                {hasValidAnalysis ? (
                  <button
                    type="button"
                    onClick={openSendReportTab}
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_45px_rgba(255,255,255,0.14)] transition hover:-translate-y-0.5 hover:bg-cyan-100"
                  >
                    Send My Full Report
                  </button>
                ) : null}
              </div>
            ) : (
              <>
            <div className="liquid-glass mx-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium text-white/78">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(103,232,249,0.85)]" />
              Arizona residential analysis
            </div>

            <h1
              className="mt-6 max-w-5xl text-5xl leading-[0.88] tracking-[-0.05em] text-white drop-shadow-[0_14px_50px_rgba(0,0,0,0.48)] md:text-6xl lg:text-7xl"
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              Your Arizona roof could save{" "}
              <span className="block italic text-white/90">
                $1,400-$2,800/year with solar.
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
              Enter your address to see real satellite roof imagery, panel
              placement, and your personalized savings estimate. No obligation.
              Takes 60 seconds.
            </p>
              </>
            )}

            {!hasValidAnalysis ? (
              <>
            <div
              id="address-estimate"
              className={`liquid-glass liquid-glass-unclipped rounded-[1.75rem] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-5 ${
                heroCompact ? "mt-0" : "mt-7"
              }`}
            >
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={(property) => {
                  const displayAddress = formatDisplayAddress(property.address);
                  setSelectedAddress(displayAddress);
                  setSolarData(null);
                  setActivePanelCount(0);
                  setShareStatus("");
                  if (displayAddress) {
                    trackEvent("address_selected", {
                      address: displayAddress,
                    });
                  }
                  setSelectedLocation(
                    displayAddress &&
                      Number.isFinite(property.lat) &&
                      Number.isFinite(property.lng)
                      ? {
                          address: displayAddress,
                          lat: Number(property.lat),
                          lng: Number(property.lng),
                        }
                      : null
                  );
                }}
              />
              {totalEstimateCount ? (
                <div className="mt-3 rounded-[1.15rem] border border-emerald-300/12 bg-emerald-300/[0.055] px-4 py-3 text-sm text-emerald-50">
                  Join{" "}
                  <span className="font-semibold">
                    {formatNumber(totalEstimateCount)}
                  </span>{" "}
                  Arizona homeowners who have gotten their free estimate.
                </div>
              ) : null}
              {neighborhoodData ? (
                <div className="mt-3 rounded-[1.15rem] border border-emerald-300/12 bg-emerald-300/[0.055] px-4 py-3 text-sm text-emerald-50">
                  <span className="mr-2 rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Estimated
                  </span>
                  <span className="font-semibold">
                    <AnimatedCount value={neighborhoodData.solarHomes} /> nearby homes
                  </span>{" "}
                  may already have solar based on local adoption data.
                </div>
              ) : null}
              <label className="mt-4 block rounded-[1.35rem] border border-white/10 bg-black/18 px-4 py-3 text-left">
                <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-cyan-100/78">
                  What is your monthly electric bill?
                </span>
                <span className="mt-2 flex items-center gap-3">
                  <span className="text-sm font-semibold text-white/70">$</span>
                  <input
                    type="number"
                    min={1}
                    value={monthlyBill}
                    onChange={(event) =>
                      setMonthlyBill(Math.max(1, Number(event.target.value) || 1))
                    }
                    placeholder="$ 200"
                    className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-white outline-none placeholder:text-white/35"
                    inputMode="decimal"
                  />
                </span>
                <span className="mt-1 block text-xs leading-5 text-white/58">
                  Used to tune savings estimates to your actual bill.
                </span>
              </label>
              {selectedAddress ? (
                <>
                  <div className="liquid-glass mt-4 rounded-[1.35rem] px-4 py-3 text-sm text-white/72">
                    Selected property:{" "}
                    <span className="font-semibold text-white">
                      {formatDisplayAddress(selectedAddress)}
                    </span>
                  </div>
                  {hasValidAnalysis ? null : (
                    <AnalysisSequence key={selectedAddress} address={selectedAddress} />
                  )}
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
              Federal 30% solar tax credit - check your savings
            </p>

            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/70">
              {["No obligation", "Estimated ranges", "Arizona only"].map((pill) => (
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

      {showAnalysis ? (
        <section
          id="solar-workspace"
          className="analysis-section relative z-10 mx-auto w-full max-w-7xl px-5 pb-8 sm:px-7 md:px-10 lg:px-12"
        >
          <div className="mb-4 flex flex-col justify-between gap-4 rounded-[1.4rem] border border-white/10 bg-slate-950/62 px-4 py-4 shadow-[0_16px_50px_rgba(2,8,20,0.3)] backdrop-blur-xl sm:px-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100/82">
                {hasValidAnalysis ? "Preliminary roof model ready" : "Solar report loading"}
              </p>
              <h2
                className="mt-2 text-2xl leading-none tracking-[-0.035em] text-white md:text-4xl"
                style={{ fontFamily: "'Instrument Serif', serif" }}
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
            {hasValidAnalysis ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === "undefined" || !selectedAddress) {
                      return;
                    }

                    const shareUrl = `${window.location.origin}/estimate?address=${encodeURIComponent(
                      selectedAddress
                    )}`;

                    void navigator.clipboard
                      ?.writeText(shareUrl)
                      .then(() => setShareStatus("Link copied to clipboard!"))
                      .catch(() => setShareStatus(shareUrl));
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/[0.1]"
                >
                  {shareStatus || "Share estimate"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div id="rooftop-analysis" className={`${hasValidAnalysis ? "lg:col-span-7" : "lg:col-span-12"} scroll-mt-24`}>
              <div className="overflow-hidden rounded-[1.5rem] border border-cyan-200/14 bg-slate-950/78 p-2 shadow-[0_22px_75px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-3">
                <SolarAnalysis
                  key={selectedAddress}
                  address={selectedAddress}
                  compact
                  location={selectedLocation}
                  monthlyBill={monthlyBill}
                  onAnalysisChange={setSolarData}
                  activePanelCount={activePanelCount || null}
                  onActivePanelCountChange={setActivePanelCount}
                  selectedPanel={selectedPanel}
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
                onMonthlyBillChange={setMonthlyBill}
                onTabChange={setReportTab}
                selectedInverterType={selectedInverterType}
                selectedPanelId={selectedPanelId}
                addBattery={addBattery}
                batteryOption={batteryOption}
                onSelectedInverterTypeChange={setSelectedInverterType}
                onSelectedPanelIdChange={setSelectedPanelId}
                onAddBatteryChange={setAddBattery}
                onBatteryOptionChange={setBatteryOption}
                sendReportContent={
                  <LeadCaptureForm
                    initialAddress={selectedAddress}
                    analysis={solarData}
                    activePanelCount={activePanelCount}
                    initialMonthlyBill={monthlyBill}
                    lat={selectedLocation?.lat}
                    lng={selectedLocation?.lng}
                    selectedInverterType={selectedInverterType}
                    selectedPanel={selectedPanel}
                    addBattery={addBattery}
                    selectedBattery={selectedBattery}
                    onMonthlyBillChange={setMonthlyBill}
                  />
                }
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <OptionalTrustSections />

      <footer className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-center px-5 pb-10 text-center text-sm text-white/56 sm:px-7 md:px-10 lg:px-12">
        <div className="liquid-glass inline-flex items-center gap-3 rounded-full px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-cyan-100" aria-hidden="true" />
          <span>{APP_PRIVACY_COPY}</span>
        </div>
      </footer>
    </main>
  );
}

function CinematicVideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);

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

  const handleLoadedData = () => {
    void videoRef.current?.play().catch(() => undefined);
  };

  const handlePlaying = () => {
    fadingOutRef.current = false;
    fadeTo(1);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;

    if (
      !video ||
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

    cancelFade();
    video.style.opacity = "0";

    if (restartTimeoutRef.current !== null) {
      window.clearTimeout(restartTimeoutRef.current);
    }

    restartTimeoutRef.current = window.setTimeout(() => {
      video.currentTime = 0;
      fadingOutRef.current = false;
      void video.play().then(() => fadeTo(1)).catch(() => undefined);
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        muted
        autoPlay
        playsInline
        preload="auto"
        onLoadedData={handleLoadedData}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className="h-full w-full translate-y-[17%] object-cover"
        style={{ opacity: 0 }}
      />
    </div>
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
      className={`print-static-ui fixed inset-x-0 top-0 z-50 hidden border-b border-white/10 bg-slate-950/88 px-5 py-2 shadow-[0_14px_42px_rgba(0,0,0,0.26)] backdrop-blur-xl transition-opacity duration-300 md:block ${
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
                ? "bg-cyan-200 text-slate-950"
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
    <div className="print-static-ui fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-5xl flex-col gap-3 rounded-[1.3rem] border border-cyan-200/18 bg-slate-950/92 px-4 py-3 text-sm text-white shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
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
          className="rounded-full bg-cyan-200 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-white"
        >
          Continue my estimate
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.1] hover:text-white"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}

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
        style={{ fontFamily: "'Instrument Serif', serif" }}
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
            <span className="mt-2 block text-xl font-semibold text-white">
              Roof, layout, and estimate without the pressure
            </span>
          </div>
          <div className="grid gap-3 px-2 pt-2 sm:px-3 lg:grid-cols-3">
            {featureCards.map((card) => (
              <FeatureCard key={card.title} title={card.title} copy={card.copy} />
            ))}
          </div>
        </div>

        <div id="reviews" className="pt-5">
          <div className="rounded-[1rem] px-2 py-3 text-left sm:px-3">
            <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
              Homeowner reviews
            </span>
            <span className="mt-2 block text-xl font-semibold text-white">
              What Arizona homeowners are saying
            </span>
          </div>
          <div className="grid gap-3 px-2 pt-2 sm:px-3 lg:grid-cols-3">
            {testimonials.map((item) => (
              <ReviewCard key={item.name} name={item.name} quote={item.quote} />
            ))}
          </div>
        </div>

        <TrustIndicatorRow />

        <FaqSection />
      </div>
    </section>
  );
}

const faqItems = [
  {
    question: "Will this damage my roof?",
    answer:
      "No. Solar panels are mounted above your existing roof surface with non-invasive racking. Most installations take 1-2 days and include a roof inspection beforehand.",
  },
  {
    question: "What if I sell my house?",
    answer:
      "Solar can add value. Homes with solar often attract buyers looking for lower utility costs, but final value depends on ownership structure, system age, and local market conditions.",
  },
  {
    question: "Is this a sales call?",
    answer:
      "No. Your estimate is generated automatically. You only hear from a solar advisor if you request it by sending your full report.",
  },
  {
    question: "How accurate is the estimate?",
    answer:
      "Roof geometry, panel placement, and sunlight data come from Google Solar API using satellite imagery. Savings are modeled from your monthly bill and Arizona utility assumptions. Final pricing requires installer confirmation.",
  },
  {
    question: "Do I need good credit?",
    answer:
      "Many Arizona homeowners qualify for $0-down solar loans. Cash and lease options may also be available. Your report compares common options.",
  },
  {
    question: "How long does installation take?",
    answer:
      "Installation commonly takes 1-2 days, plus additional time for permits, utility approval, and final inspection.",
  },
] as const;

function TrustIndicatorRow() {
  return (
    <div className="mx-2 mt-5 flex flex-wrap items-center justify-center gap-3 rounded-[1rem] border border-white/8 bg-white/[0.04] px-4 py-3 text-xs font-semibold text-white/62 sm:mx-3">
      <span>Powered by</span>
      <span className="rounded-full border border-cyan-200/18 bg-cyan-300/10 px-3 py-1 text-cyan-100">
        Google Solar API
      </span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>SSL secured</span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>No spam, ever</span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <span>Arizona licensed installers</span>
    </div>
  );
}

function FaqSection() {
  return (
    <div className="mx-2 mt-5 rounded-[1.15rem] border border-white/8 bg-slate-950/40 p-3 sm:mx-3">
      <div className="px-2 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
          Common questions
        </p>
      </div>
      <div className="grid gap-2">
        {faqItems.map((item) => (
          <details
            key={item.question}
            className="group rounded-[0.95rem] border border-white/8 bg-white/[0.035] px-4 py-3"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
              {item.question}
              <span className="text-cyan-100 group-open:hidden">+</span>
              <span className="hidden text-cyan-100 group-open:inline">-</span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-white/66">{item.answer}</p>
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

function AnimatedCount({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const durationMs = 1000;
    const startedAt = window.performance.now();
    let frameId = 0;

    const tick = (time: number) => {
      const progress = Math.min((time - startedAt) / durationMs, 1);
      setDisplayValue(Math.round(value * progress));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return <>{formatNumber(displayValue)}</>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function extractArizonaZip(address: string) {
  return address.match(/\bAZ\s+(\d{5})(?:-\d{4})?\b/i)?.[1] ?? "";
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

function ReviewCard({ name, quote }: { name: string; quote: string }) {
  return (
    <article className="liquid-glass h-full rounded-[1.25rem] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="flex gap-1 text-amber-200">
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={`${name}-${index}`}
            className="h-4 w-4 fill-current"
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="mt-5 text-sm leading-7 text-white/72">&ldquo;{quote}&rdquo;</p>
      <p className="mt-5 text-sm font-semibold text-white">{name}</p>
      <p className="mt-2 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-cyan-100/66">
        Verified Arizona homeowner
      </p>
    </article>
  );
}
