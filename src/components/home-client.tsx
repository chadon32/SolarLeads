"use client";

import {
  ArrowRight,
  DollarSign,
  FileText,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [selectedLocation, setSelectedLocation] = useState<{
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const hasValidAnalysis = Boolean(roofAnalysis?.validSite);

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
  const highlights = useMemo(
    () => [
      {
        icon: Sun,
        value: roofAnalysis
          ? `${roofAnalysis.annualSunlightHours.toLocaleString()} hrs`
          : "1,700–2,100 hrs",
        label: roofAnalysis
          ? "Annual usable sunlight estimated for the detected roof"
          : "Typical annual rooftop sunlight for Arizona detached homes",
      },
      {
        icon: DollarSign,
        value: roofAnalysis
          ? `$${roofAnalysis.annualSavingsUSD.toLocaleString()}/yr`
          : "$2.8K–$4.1K",
        label: roofAnalysis
          ? "Estimated yearly savings for this address"
          : "Estimated yearly savings range",
      },
      {
        icon: ShieldCheck,
        value: roofAnalysis
          ? `${roofAnalysis.rooftopConfidenceScore}/100`
          : "High-confidence",
        label: roofAnalysis
          ? "Rooftop confidence score from the current property analysis"
          : "Expected rooftop suitability for detached Arizona homes",
      },
    ],
    [roofAnalysis]
  );

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
            Get My Free Estimate
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-20 pt-5 sm:px-7 md:px-10 lg:px-12">
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
            <a className="transition hover:text-white" href="#why-arizona">
              Why Arizona
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
              href="#address-estimate"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100 sm:px-5"
            >
              <span className="hidden sm:inline">Get My Free Estimate</span>
              <span className="sm:hidden">Estimate</span>
            </a>
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[minmax(0,1.05fr)_25rem] lg:py-20">
          <div className="max-w-4xl text-center lg:text-left">
            <div className="liquid-glass mx-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium text-white/78 lg:mx-0">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(103,232,249,0.85)]" />
              Arizona residential analysis
            </div>

            <h1
              className="mt-7 max-w-5xl text-5xl leading-[0.86] tracking-[-0.05em] text-white drop-shadow-[0_14px_50px_rgba(0,0,0,0.48)] md:text-7xl lg:text-8xl"
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              See your home with solar —{" "}
              <span className="block italic text-white/90">
                before you commit to anything.
              </span>
            </h1>

            <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-white/68 sm:text-lg lg:mx-0">
              Type your address below to review rooftop imagery, estimated panel
              placement, and a modeled savings profile for your property. No
              obligation.
            </p>

            <div
              id="address-estimate"
              className="liquid-glass liquid-glass-unclipped mt-8 rounded-[2rem] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-6"
            >
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={(property) => {
                  setSelectedAddress(property.address);
                  setRoofAnalysis(null);
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
                  <AnalysisSequence key={selectedAddress} address={selectedAddress} />
                </>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
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

            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/70 lg:justify-start">
              {["No obligation", "Estimated ranges", "Arizona only"].map((pill) => (
                <span key={pill} className="liquid-glass rounded-full px-3 py-2">
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div id="why-arizona" className="grid gap-4">
            {highlights.map((item, index) => (
              <StatCard
                key={item.label}
                icon={item.icon}
                value={item.value}
                label={item.label}
                className={
                  index === 1
                    ? "lg:translate-x-8"
                    : index === 2
                      ? "lg:translate-x-2"
                      : ""
                }
              />
            ))}
          </div>
        </div>
      </section>

      {showAnalysis ? (
        <section
          id="solar-workspace"
          className="analysis-section relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-7 md:px-10 lg:px-12"
        >
          <SectionIntro
            eyebrow="Solar workspace"
            title="A practical rooftop analysis workspace built around the actual property."
            copy="Satellite imagery, roof segmentation, panel placement, and financial estimates are organized in one clear analysis surface."
          />
          <div className="liquid-glass mt-7 overflow-hidden rounded-[2rem] p-2 shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-3">
            <SolarAnalysis
              key={selectedAddress}
              address={selectedAddress}
              location={selectedLocation}
              onAnalysisChange={setRoofAnalysis}
            />
          </div>
        </section>
      ) : null}

      {hasValidAnalysis && roofAnalysis ? (
        <SolarReportDashboard address={selectedAddress} analysis={roofAnalysis} />
      ) : null}

      <section
        id="how-it-works"
        className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-7 md:px-10 lg:px-12"
      >
        <SectionIntro
          eyebrow="Why it works"
          title="See your roof, your layout, and your estimate without the pressure."
          copy="We keep the experience simple so you can evaluate the roof, the savings, and the next step on your own terms."
        />
        <div className="mt-7 grid gap-4 lg:grid-cols-3">
          {featureCards.map((card) => (
            <FeatureCard key={card.title} title={card.title} copy={card.copy} />
          ))}
        </div>
      </section>

      <section
        id="reviews"
        className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-7 md:px-10 lg:px-12"
      >
        <div className="liquid-glass rounded-[2.2rem] p-5 shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
            Homeowner reviews
          </p>
          <h2
            className="mt-4 text-4xl leading-none tracking-[-0.035em] text-white md:text-6xl"
            style={{ fontFamily: "'Instrument Serif', serif" }}
          >
            What Arizona homeowners are saying
          </h2>
          <div className="mt-7 grid snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid-cols-3 lg:overflow-visible">
            {testimonials.map((item) => (
              <ReviewCard key={item.name} name={item.name} quote={item.quote} />
            ))}
          </div>
        </div>
      </section>

      {hasValidAnalysis ? (
        <section
          id="contact"
          className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-7 md:px-10 lg:px-12"
        >
          <SectionIntro
            eyebrow="Generate report"
            title="Ready to see your full report? Enter your details and we’ll send it instantly."
            copy="We only need a few details to generate the report and send the estimate to you."
          />
          <div className="mt-7">
            <LeadCaptureForm
              initialAddress={selectedAddress}
              analysis={roofAnalysis}
              lat={selectedLocation?.lat}
              lng={selectedLocation?.lng}
            />
          </div>
        </section>
      ) : null}

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

function StatCard({
  icon: Icon,
  value,
  label,
  className = "",
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <article
      className={`liquid-glass rounded-[1.8rem] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-cyan-200/12 text-cyan-100">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span
          className="rounded-full border border-cyan-100/14 bg-cyan-100/8 px-2.5 py-1 text-[0.56rem] font-semibold uppercase tracking-[0.28em] text-cyan-100"
          title="This is a modeled estimate. Your final report will include measurements specific to your roof."
        >
          Est.
        </span>
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-white/58">{label}</p>
    </article>
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
  return (
    <div className="mx-auto max-w-4xl text-center">
      <span className="liquid-glass inline-flex rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
        {eyebrow}
      </span>
      <h2
        className="mt-5 text-4xl leading-[0.95] tracking-[-0.04em] text-white md:text-6xl"
        style={{ fontFamily: "'Instrument Serif', serif" }}
      >
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/62">
        {copy}
      </p>
    </div>
  );
}

function FeatureCard({ title, copy }: { title: string; copy: string }) {
  return (
    <article className="liquid-glass rounded-[1.8rem] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="mb-7 h-px w-20 bg-gradient-to-r from-cyan-200/80 to-transparent" />
      <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-white/62">{copy}</p>
    </article>
  );
}

function ReviewCard({ name, quote }: { name: string; quote: string }) {
  return (
    <article className="liquid-glass min-w-[18rem] snap-start rounded-[1.7rem] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
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
