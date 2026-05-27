"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AddressSearch } from "@/components/address-search";
import { AnalysisSequence } from "@/components/analysis-sequence";
import { InstallReadouts } from "@/components/install-readouts";
import { LeadCaptureForm } from "@/components/lead-capture-form";
import { ButtonLink } from "@/components/ui/button";
import { SectionDivider } from "@/components/section-divider";
import { SatellitePreview } from "@/components/satellite-preview";
import { SavingsStats } from "@/components/savings-stats";
import type { RoofAnalysis } from "@/lib/roof-analysis";

const HouseShowcase = dynamic(
  () => import("@/components/house-showcase").then((module) => module.HouseShowcase),
  {
    ssr: false,
    loading: () => null,
  }
);

const highlights = [
  {
    value: "18-28",
    label: "Panels estimated for a typical Arizona roof",
  },
  {
    value: "2-6 deg",
    label: "Typical low-slope roof pitch range",
  },
  {
    value: "$2.8K-$4.1K",
    label: "Estimated yearly savings range",
  },
] as const;

const featureCards = [
  {
    title: "Address-driven preview",
    copy: "Choose a real Arizona property and we will load the roof story that goes with that home.",
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
    stars: 5,
  },
  {
    name: "Sandra R., Scottsdale AZ",
    quote:
      "The estimate was within $200 of what we actually got quoted. Really impressed.",
    stars: 5,
  },
  {
    name: "James K., Mesa AZ",
    quote:
      "No spam after I submitted. Got my report, reviewed it, and called them when I was ready.",
    stars: 5,
  },
] as const;

const BUSINESS_PHONE = "(602) 555-0100";
const BUSINESS_PHONE_HREF = "tel:+16025550100";

export function HomeClient() {
  const [selectedAddress, setSelectedAddress] = useState("");
  const [roofAnalysis, setRoofAnalysis] = useState<RoofAnalysis | null>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      const contactTop = document.getElementById("contact")?.offsetTop ?? Number.POSITIVE_INFINITY;
      setShowStickyCta(scrollY > 300 && scrollY < contactTop - 200);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showAnalysis = Boolean(selectedAddress);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),radial-gradient(circle_at_80%_20%,_rgba(0,182,255,0.16),_transparent_26%),linear-gradient(180deg,#05070d_0%,#07111d_36%,#0b1625_68%,#06070b_100%)] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-6rem] top-[-5rem] h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute right-[-10rem] top-24 h-[30rem] w-[30rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/2 h-72 w-[46rem] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
      </div>

      {showStickyCta ? (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4 md:inset-x-auto md:right-6 md:bottom-6 md:p-0">
          <ButtonLink
            href="#contact"
            variant="primary"
            className="w-full px-6 py-4 text-sm md:w-auto md:rounded-full"
          >
            Get My Free Estimate
          </ButtonLink>
        </div>
      ) : null}

      <section
        className={`page-enter relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pt-8 md:px-10 lg:px-12 ${
          showAnalysis ? "min-h-screen pb-24 md:pb-10" : "pb-16"
        }`}
      >
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.36em] text-slate-400">
              Arizona Solar AI
            </p>
            <p className="mt-2 text-sm font-medium tracking-tight text-slate-200 sm:text-base">
              Real roof analysis for Arizona homeowners
            </p>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <a
              href={BUSINESS_PHONE_HREF}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 shadow-[0_12px_40px_rgba(2,8,20,0.32)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              Call {BUSINESS_PHONE}
            </a>
            <ButtonLink
              href="#contact"
              variant="secondary"
              className="hidden px-5 py-3 text-sm font-medium md:inline-flex"
            >
              Get My Free Estimate
            </ButtonLink>
          </div>
        </header>

        <div className={`grid items-start gap-10 ${showAnalysis ? "lg:grid-cols-[1fr_0.96fr]" : "lg:grid-cols-[1fr]"}`}>
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 shadow-[0_12px_40px_rgba(2,8,20,0.3)] backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)]" />
              Arizona-only solar roof preview
            </div>

            <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              See your home with solar - before you commit to anything.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Type your address below and get a real roof analysis, panel placement, and savings estimate in under 60 seconds. No sales calls. No obligation.
            </p>

            <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_50px_rgba(2,8,20,0.26)] backdrop-blur-xl">
              <AddressSearch selectedAddress={selectedAddress} onSelect={setSelectedAddress} />
              {selectedAddress ? (
                <>
                  <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
                    Selected property:{" "}
                    <span className="font-semibold text-white">{selectedAddress}</span>
                  </div>
                  <AnalysisSequence key={selectedAddress} address={selectedAddress} />
                </>
              ) : null}
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <ButtonLink href="#contact" variant="primary" className="px-6 py-3.5">
                Get My Free Estimate
              </ButtonLink>
              <ButtonLink href={BUSINESS_PHONE_HREF} variant="secondary" className="px-6 py-3.5">
                Call {BUSINESS_PHONE}
              </ButtonLink>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                No obligation
              </span>
              <span
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
                title="This is a modeled estimate. Your final report will include measurements specific to your roof."
              >
                Estimated ranges
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Arizona only
              </span>
            </div>

            <dl className="mt-10 grid gap-4 sm:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="glass-panel rounded-3xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-3xl font-semibold tracking-tight text-white">
                      {item.value}
                    </dt>
                    <span
                      className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-[0.56rem] font-semibold uppercase tracking-[0.28em] text-cyan-200"
                      title="This is a modeled estimate. Your final report will include measurements specific to your roof."
                    >
                      Est.
                    </span>
                  </div>
                  <dd className="mt-2 text-sm leading-6 text-slate-300">
                    {item.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {showAnalysis ? (
            <div className="analysis-section relative">
              <div className="absolute -inset-4 rounded-[2rem] bg-cyan-400/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-3 shadow-[0_28px_100px_rgba(2,8,20,0.55)] backdrop-blur-xl">
                <HouseShowcase selectedAddress={selectedAddress} analysis={roofAnalysis} />
              </div>
              <SatellitePreview address={selectedAddress} onAnalysisChange={setRoofAnalysis} />
            </div>
          ) : null}
        </div>
      </section>

      {showAnalysis ? (
        <>
          <SectionDivider
            eyebrow="Roof analysis"
            title="See exactly where panels go on your roof - before you talk to anyone."
            copy="Your roof analysis, panel layout, and savings estimate - all in one place."
          />

          <div className="analysis-section">
            <InstallReadouts
              selectedAddress={selectedAddress}
              analysis={roofAnalysis}
            />
          </div>

          <SectionDivider
            eyebrow="Savings"
            title="Your savings, at a glance."
            copy="Modeled estimate - updates with your address."
          />

          <div className="analysis-section">
            <SavingsStats selectedAddress={selectedAddress} analysis={roofAnalysis} />
          </div>
        </>
      ) : null}

      <SectionDivider
        eyebrow="Why it works"
        title="See your roof, your layout, and your estimate without the pressure."
        copy="We keep the experience simple so you can evaluate the roof, the savings, and the next step on your own terms."
      />

      <section
        id="details"
        className="relative mx-auto grid w-full max-w-7xl gap-6 px-6 pb-8 md:px-10 lg:px-12 lg:grid-cols-3"
      >
        {featureCards.map((card) => (
          <article key={card.title} className="glass-panel rounded-[1.75rem] p-6">
            <h3 className="text-lg font-semibold text-white">{card.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-300">{card.copy}</p>
          </article>
        ))}
      </section>

      <section className="relative mx-auto w-full max-w-7xl px-6 pb-8 md:px-10 lg:px-12">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_24px_70px_rgba(2,8,20,0.35)] backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Homeowner reviews
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What Arizona homeowners are saying
          </h3>
          <div className="mt-6 grid snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid-cols-3 md:overflow-visible">
            {testimonials.map((item) => (
              <article
                key={item.name}
                className="glass-panel min-w-[18rem] snap-start rounded-[1.5rem] p-5"
              >
                <div className="flex gap-1 text-amber-300">
                  {Array.from({ length: item.stars }).map((_, index) => (
                    <span key={`${item.name}-${index}`}>★</span>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-200">{item.quote}</p>
                <p className="mt-4 text-sm font-semibold text-white">{item.name}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider
        eyebrow="Conversion"
        title="Ready to see your full report? Enter your details and we'll send it instantly."
        copy="We only need a few details to generate the report and send the estimate to you."
      />

      <section
        id="contact"
        className="relative mx-auto w-full max-w-7xl px-6 pb-16 md:px-10 lg:px-12"
      >
        <LeadCaptureForm initialAddress={selectedAddress} />
      </section>
    </main>
  );
}
