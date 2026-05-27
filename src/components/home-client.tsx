"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
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
    loading: () => (
      <div className="flex h-[31rem] items-center justify-center rounded-[1.9rem] border border-white/10 bg-[linear-gradient(180deg,rgba(3,7,15,0.95),rgba(5,10,18,0.98))] text-sm text-slate-300 sm:h-[36rem]">
        Loading rooftop model...
      </div>
    ),
  }
);

const highlights = [
  {
    value: "24",
    label: "Panels previewed on the garage roof plane",
  },
  {
    value: "2.9°",
    label: "Roof pitch measured for panel placement",
  },
  {
    value: "$3.2K",
    label: "Projected annual utility savings",
  },
];

const flowSteps = ["Address", "Roof scan", "3D model", "Report"] as const;

const featureCards = [
  {
    title: "Address-driven preview",
    copy: "Type a real address, choose from autocomplete, and load the property preview instantly.",
  },
  {
    title: "Roof-aware placement",
    copy: "Panels are grouped on the open roof planes instead of blocking windows, patios, or parapet edges.",
  },
  {
    title: "Installer-ready story",
    copy: "The page shows where the system goes before asking the visitor to start a quote.",
  },
];

export function HomeClient() {
  const [selectedAddress, setSelectedAddress] = useState(
    "7140 E Via Dona Rd, Scottsdale, AZ"
  );
  const [roofAnalysis, setRoofAnalysis] = useState<RoofAnalysis | null>(null);

  const activeStep =
    roofAnalysis?.estimatedPanelCount
      ? 3
      : roofAnalysis?.zoom
        ? 2
        : selectedAddress
          ? 1
          : 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),radial-gradient(circle_at_80%_20%,_rgba(0,182,255,0.16),_transparent_26%),linear-gradient(180deg,#05070d_0%,#07111d_36%,#0b1625_68%,#06070b_100%)] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-6rem] top-[-5rem] h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute right-[-10rem] top-24 h-[30rem] w-[30rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/2 h-72 w-[46rem] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center p-4 md:hidden">
        <div className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-[1.4rem] border border-white/10 bg-slate-950/90 px-4 py-3 shadow-[0_18px_50px_rgba(2,8,20,0.5)] backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
              Start here
            </p>
            <p className="truncate text-sm text-white">Analyze your roof in under a minute.</p>
          </div>
          <ButtonLink href="#contact" variant="primary" className="shrink-0 px-4 py-2">
            Get estimate
          </ButtonLink>
        </div>
      </div>

      <section className="page-enter relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 pb-24 pt-8 md:px-10 md:pb-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.36em] text-slate-400">
              Arizona Residence
            </p>
            <h1 className="mt-2 text-lg font-semibold tracking-tight text-slate-100 sm:text-xl">
              Address-to-roof solar preview
            </h1>
          </div>
          <ButtonLink
            href="#contact"
            variant="secondary"
            className="hidden px-5 py-3 text-sm font-medium md:inline-flex"
          >
            Get my estimate
          </ButtonLink>
        </header>

        <div className="grid gap-6 rounded-[1.6rem] border border-white/10 bg-white/5 px-4 py-4 shadow-[0_18px_50px_rgba(2,8,20,0.2)] backdrop-blur-xl sm:px-5">
          <div className="flex snap-x snap-mandatory items-center gap-3 overflow-x-auto pb-1 pr-1 md:flex-wrap md:overflow-visible md:pb-0 md:pr-0">
            {flowSteps.map((step, index) => {
              const active = index <= activeStep;
              const reached = index === activeStep;

              return (
                <div
                  key={step}
                  className={`flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.28em] ${
                    active
                      ? "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-white/5 text-slate-400"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      reached ? "bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)]" : "bg-slate-500"
                    }`}
                  />
                  {step}
                </div>
              );
            })}
          </div>
          <p className="text-sm leading-6 text-slate-300">
            Step 1: enter an address. Step 2: inspect the roof. Step 3: preview panel placement.
            Step 4: capture the lead and generate the report.
          </p>
        </div>

        <div className="grid flex-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative order-2 z-10 max-w-2xl lg:order-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 shadow-[0_12px_40px_rgba(2,8,20,0.3)] backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)]" />
              Type an address, pick a result, and preview the roof
            </div>

            <h2 className="mt-6 max-w-xl text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Solar starts with the address.
            </h2>

            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Enter a property, confirm the match, and see how the roof, panel
              placement, and savings story come together for that exact home.
            </p>

            <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_50px_rgba(2,8,20,0.26)] backdrop-blur-xl">
              <AddressSearch
                selectedAddress={selectedAddress}
                onSelect={setSelectedAddress}
              />
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
                Selected property:{" "}
                <span className="font-semibold text-white">{selectedAddress}</span>
              </div>
              <AnalysisSequence key={selectedAddress} address={selectedAddress} />
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <ButtonLink href="#details" variant="primary" className="px-6 py-3.5">
                See the roof analysis
              </ButtonLink>
              <ButtonLink href="#contact" variant="secondary" className="px-6 py-3.5">
                Get my solar estimate
              </ButtonLink>
            </div>

            <ButtonLink
              href="/dashboard"
              variant="ghost"
              className="mt-4 gap-2 px-4 py-2.5 text-sm"
            >
              Open homeowner dashboard
              <span aria-hidden="true">&rarr;</span>
            </ButtonLink>

            <div className="mt-4 flex flex-wrap gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                No obligation
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Arizona homes only
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Estimate in under a minute
              </span>
            </div>

            <dl className="mt-10 grid gap-4 sm:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="glass-panel rounded-3xl p-4">
                  <dt className="text-3xl font-semibold tracking-tight text-white">
                    {item.value}
                  </dt>
                  <dd className="mt-2 text-sm leading-6 text-slate-300">
                    {item.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative order-1 lg:order-2">
            <div className="absolute -inset-4 rounded-[2rem] bg-cyan-400/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-3 shadow-[0_28px_100px_rgba(2,8,20,0.55)] backdrop-blur-xl">
              <HouseShowcase
                selectedAddress={selectedAddress}
                analysis={roofAnalysis}
              />
            </div>
            <SatellitePreview
              address={selectedAddress}
              onAnalysisChange={setRoofAnalysis}
            />
          </div>
        </div>
      </section>

      <SectionDivider
        eyebrow="Roof analysis"
        title="A clean rooftop story, from scan to placement."
        copy="Each step stays visually separated so the homeowner can move from the address, to the roof, to the estimate without losing context."
      />

      <InstallReadouts selectedAddress={selectedAddress} />

      <SectionDivider
        eyebrow="Savings"
        title="The estimate stays readable at a glance."
        copy="Key numbers are grouped into a tighter rhythm so the savings narrative feels polished, legible, and easy to scan on any screen."
      />

      <SavingsStats />

      <SectionDivider
        eyebrow="Why it works"
        title="A premium summary before the conversion moment."
        copy="The supporting cards and the final lead capture stay visually separated, which gives the page a calmer pace and stronger hierarchy."
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

      <SectionDivider
        eyebrow="Conversion"
        title="A final handoff that feels intentional."
        copy="The form lands after the story has done the heavy lifting, so the ask feels like the natural next step rather than a hard stop."
      />

      <section
        id="contact"
        className="relative mx-auto w-full max-w-7xl px-6 pb-12 md:px-10 lg:px-12"
      >
        <LeadCaptureForm initialAddress={selectedAddress} />
      </section>
    </main>
  );
}
