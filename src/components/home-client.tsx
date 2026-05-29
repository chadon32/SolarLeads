"use client";

import {
  ArrowRight,
  FileText,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AddressSearch } from "@/components/address-search";
import { AnalysisSequence } from "@/components/analysis-sequence";
import { LeadCaptureForm } from "@/components/lead-capture-form";
import { SolarAnalysis } from "@/components/solar-analysis";
import { SolarReportDashboard } from "@/components/solar-report-dashboard";
import type { RoofAnalysis } from "@/lib/roof-analysis";

const VIDEO_SRC =
  "/Drone_shot_over_solar_neighborhood_202605281518.mp4";

const featureCards = [
  {
    title: "Address-driven preview",
    copy: "Choose a real Arizona property and we’ll load the roof story that goes with that home.",
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

const BUSINESS_PHONE = "(602) 555-0100";
const BUSINESS_PHONE_HREF = "tel:+16025550100";

export function HomeClient() {
  const [selectedAddress, setSelectedAddress] = useState("");
  const [roofAnalysis, setRoofAnalysis] = useState<RoofAnalysis | null>(null);
  const [activePanelCount, setActivePanelCount] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState<{
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const hasValidAnalysis = Boolean(roofAnalysis?.validSite);
  const heroCompact = Boolean(selectedAddress);

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      const contactTop =
        document.getElementById("contact")?.offsetTop ?? Number.POSITIVE_INFINITY;
      const workspace = document.getElementById("solar-workspace");
      const workspaceTop = workspace?.offsetTop ?? Number.POSITIVE_INFINITY;
      const workspaceBottom = workspaceTop + (workspace?.offsetHeight ?? 0);
      const workspaceVisible =
        scrollY + window.innerHeight > workspaceTop + 120 &&
        scrollY < workspaceBottom - 120;

      setShowStickyCta(
        hasValidAnalysis &&
          scrollY > 300 &&
          scrollY < contactTop - 200 &&
          !workspaceVisible
      );
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, [hasValidAnalysis]);

  const showAnalysis = Boolean(selectedAddress);
  const reportCtaHref = hasValidAnalysis
    ? "#contact"
    : selectedAddress
      ? "#solar-workspace"
      : "#address-estimate";
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-black text-white">
      <CinematicVideoBackground />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(circle_at_22%_20%,rgba(103,232,249,0.16),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.34)_45%,rgba(0,0,0,0.72)_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1] h-1/2 bg-gradient-to-t from-black via-black/58 to-transparent" />

      {showStickyCta ? (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4 md:inset-x-auto md:right-6 md:bottom-6 md:p-0">
          <a
            href="#contact"
            className="liquid-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-sm font-semibold text-white shadow-[0_22px_70px_rgba(103,232,249,0.2)] transition hover:-translate-y-0.5 md:w-auto"
          >
            Send My Full Report
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
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
                Arizona Solar AI
              </span>
              <span className="hidden text-xs text-white/52 sm:block">
                Solar site analysis for Arizona homeowners
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
              Report
            </a>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <a
              href={BUSINESS_PHONE_HREF}
              className="liquid-glass hidden items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white/90 transition hover:-translate-y-0.5 hover:text-white sm:inline-flex"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call {BUSINESS_PHONE}
            </a>
            <a
              href={hasValidAnalysis ? "#contact" : "#address-estimate"}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100 sm:px-5"
            >
              <span className="hidden sm:inline">
                {hasValidAnalysis ? "Send My Full Report" : "Get My Free Estimate"}
              </span>
              <span className="sm:hidden">{hasValidAnalysis ? "Send" : "Estimate"}</span>
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
                    {selectedAddress}
                  </h1>
                  <p className="mt-1 text-sm text-white/58">
                    {hasValidAnalysis
                      ? "Review the roof workspace below, then send the full PDF report."
                      : "Satellite imagery and Solar API roof data are loading."}
                  </p>
                </div>
                {hasValidAnalysis ? (
                  <a
                    href="#contact"
                    className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-100"
                  >
                    Send My Full Report
                  </a>
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
              See your home with solar -{" "}
              <span className="block italic text-white/90">
                before you commit to anything.
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
              Type your address below to review rooftop imagery, estimated panel
              placement, and a modeled savings profile for your property. No
              obligation.
            </p>
              </>
            )}

            <div
              id="address-estimate"
              className={`liquid-glass liquid-glass-unclipped rounded-[1.75rem] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-5 ${
                heroCompact ? "mt-0" : "mt-7"
              }`}
            >
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={(property) => {
                  setSelectedAddress(property.address);
                  setRoofAnalysis(null);
                  setActivePanelCount(0);
                  setSelectedLocation(
                    property.address &&
                      Number.isFinite(property.lat) &&
                      Number.isFinite(property.lng)
                      ? {
                          address: property.address,
                          lat: Number(property.lat),
                          lng: Number(property.lng),
                        }
                      : null
                  );
                }}
              />
              {selectedAddress ? (
                <>
                  <div className="liquid-glass mt-4 rounded-[1.35rem] px-4 py-3 text-sm text-white/72">
                    Selected property:{" "}
                    <span className="font-semibold text-white">
                      {selectedAddress}
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
                <FileText className="h-4 w-4" aria-hidden="true" />
                Generate Free Report
              </a>
              <a
                href={BUSINESS_PHONE_HREF}
                className="liquid-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-sm font-semibold text-white/88 transition hover:-translate-y-0.5 hover:text-white sm:w-auto"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call {BUSINESS_PHONE}
              </a>
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/70">
              {["No obligation", "Estimated ranges", "Arizona only"].map((pill) => (
                <span key={pill} className="liquid-glass rounded-full px-3 py-2">
                  {pill}
                </span>
              ))}
            </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {showAnalysis ? (
        <section
          id="solar-workspace"
          className="analysis-section relative z-10 mx-auto w-full max-w-7xl px-5 pb-6 sm:px-7 md:px-10 lg:px-12"
        >
          <div className="mb-4 flex flex-col justify-between gap-3 rounded-[1.4rem] border border-white/10 bg-slate-950/58 px-4 py-4 shadow-[0_16px_50px_rgba(2,8,20,0.3)] backdrop-blur-xl sm:flex-row sm:items-end">
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
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                {selectedAddress}
              </p>
            </div>
            {hasValidAnalysis ? (
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-100"
              >
                Send My Full Report
              </a>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className={hasValidAnalysis ? "lg:col-span-7" : "lg:col-span-12"}>
              <div className="overflow-hidden rounded-[1.5rem] border border-cyan-200/12 bg-slate-950/72 p-2 shadow-[0_22px_75px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                <SolarAnalysis
                  key={selectedAddress}
                  address={selectedAddress}
                  compact
                  location={selectedLocation}
                  onAnalysisChange={setRoofAnalysis}
                  activePanelCount={activePanelCount || null}
                  onActivePanelCountChange={setActivePanelCount}
                />
              </div>
            </div>
            {hasValidAnalysis && roofAnalysis ? (
              <SolarReportDashboard
                address={selectedAddress}
                analysis={roofAnalysis}
                activePanelCount={activePanelCount}
                onActivePanelCountChange={setActivePanelCount}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {hasValidAnalysis ? (
        <section
          id="contact"
          className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-12 sm:px-7 md:px-10 lg:px-12"
        >
          <SectionIntro
            eyebrow="Generate report"
            title="Send your full solar report."
            copy="We only need a few details to generate the report and send the estimate to you."
          />
          <div className="mt-5">
            <LeadCaptureForm
              initialAddress={selectedAddress}
              analysis={roofAnalysis}
              lat={selectedLocation?.lat}
              lng={selectedLocation?.lng}
            />
          </div>
        </section>
      ) : null}

      <OptionalTrustSections />

      <footer className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-center px-5 pb-10 text-center text-sm text-white/56 sm:px-7 md:px-10 lg:px-12">
        <div className="liquid-glass inline-flex items-center gap-3 rounded-full px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-cyan-100" aria-hidden="true" />
          <span>Your information is secure. We respect your privacy.</span>
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
      <div className="liquid-glass rounded-[1.5rem] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-4">
        <details id="how-it-works" className="group border-b border-white/10 pb-3" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[1rem] px-3 py-3 text-left transition hover:bg-white/[0.04]">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Why it works
              </span>
              <span className="mt-1 block text-lg font-semibold text-white">
                Roof, layout, and estimate without the pressure
              </span>
            </span>
            <span className="text-sm font-semibold text-white/50 group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="grid gap-3 px-3 pb-3 pt-2 lg:grid-cols-3">
            {featureCards.map((card) => (
              <FeatureCard key={card.title} title={card.title} copy={card.copy} />
            ))}
          </div>
        </details>

        <details id="reviews" className="group pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[1rem] px-3 py-3 text-left transition hover:bg-white/[0.04]">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Homeowner reviews
              </span>
              <span className="mt-1 block text-lg font-semibold text-white">
                What Arizona homeowners are saying
              </span>
            </span>
            <span className="text-sm font-semibold text-white/50 group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="grid snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 pt-2 lg:grid-cols-3 lg:overflow-visible">
            {testimonials.map((item) => (
              <ReviewCard key={item.name} name={item.name} quote={item.quote} />
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function FeatureCard({ title, copy }: { title: string; copy: string }) {
  return (
    <article className="liquid-glass rounded-[1.35rem] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)]">
      <div className="mb-5 h-px w-20 bg-gradient-to-r from-cyan-200/80 to-transparent" />
      <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-white/62">{copy}</p>
    </article>
  );
}

function ReviewCard({ name, quote }: { name: string; quote: string }) {
  return (
    <article className="liquid-glass min-w-[18rem] snap-start rounded-[1.25rem] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="flex gap-1 text-amber-200">
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={`${name}-${index}`}
            className="h-4 w-4 fill-current"
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="mt-5 text-sm leading-7 text-white/72">“{quote}”</p>
      <p className="mt-5 text-sm font-semibold text-white">{name}</p>
    </article>
  );
}
