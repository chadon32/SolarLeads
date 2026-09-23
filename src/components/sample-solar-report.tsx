"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ILLUSTRATIVE_SOLAR_SAMPLE } from "@/lib/illustrative-solar-sample";
import { trackEvent } from "@/lib/analytics";

const SAMPLE_EVENT_PARAMS = {
  placement: "home_sample",
  content_version: "illustrative_v1",
} as const;

export function SampleSolarReport() {
  const sampleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = sampleRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    let reported = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!reported && entry?.isIntersecting) {
          reported = true;
          trackEvent("sample_report_viewed", SAMPLE_EVENT_PARAMS);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const handleContinue = () => {
    trackEvent("sample_report_cta_clicked", SAMPLE_EVENT_PARAMS);
  };

  return (
    <section
      ref={sampleRef}
      aria-labelledby="illustrative-sample-title"
      className="mx-auto mt-6 w-full max-w-6xl rounded-[1.5rem] border border-cyan-200/18 bg-slate-950/80 p-4 text-left shadow-[0_22px_75px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:mt-8 sm:p-5"
      data-testid="illustrative-sample-report"
    >
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
        <div className="relative overflow-hidden rounded-[1.15rem] border border-white/10 bg-[#07131c] p-3">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(103,232,249,0.22),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.3),rgba(2,6,23,0.86))]" />
          <div className="relative flex min-h-52 flex-col justify-between sm:min-h-60">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.25em] text-cyan-100/80">
                  Roof preview
                </p>
                <p className="mt-1 text-sm font-semibold text-white">Example only</p>
              </div>
              <span className="rounded-full border border-amber-200/25 bg-amber-200/10 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-amber-100">
                Illustrative
              </span>
            </div>

            <svg
              viewBox="0 0 520 300"
              role="img"
              aria-label="Illustrative roof plane with a sample solar panel layout"
              className="h-auto w-full"
            >
              <defs>
                <linearGradient id="sample-roof-fill" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#35536a" />
                  <stop offset="1" stopColor="#152b3b" />
                </linearGradient>
                <pattern id="sample-panel-grid" width="42" height="30" patternUnits="userSpaceOnUse">
                  <rect width="38" height="26" rx="3" fill="#0a2742" stroke="#79c9df" strokeOpacity="0.7" />
                  <path d="M19 0v26M0 13h38" stroke="#65b8d0" strokeOpacity="0.2" />
                </pattern>
              </defs>
              <polygon
                points="80,70 355,40 460,130 414,247 136,262 54,178"
                fill="url(#sample-roof-fill)"
                stroke="#8bd7ea"
                strokeOpacity="0.65"
                strokeWidth="3"
              />
              <polygon
                points="130,92 346,68 411,130 382,211 159,224 102,166"
                fill="url(#sample-panel-grid)"
                stroke="#9ee8f4"
                strokeOpacity="0.35"
                strokeWidth="2"
              />
              <path d="M54 178 136 262 414 247" fill="none" stroke="#0b1721" strokeWidth="10" strokeOpacity="0.75" />
              <circle cx="424" cy="73" r="18" fill="#fde68a" fillOpacity="0.86" />
              <path d="M424 40v-13M424 106v13M391 73h-13M457 73h13" stroke="#fde68a" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
            </svg>

            <p className="mt-2 max-w-sm text-xs leading-5 text-white/58">
              A representative roof layout helps explain the report before you enter a property.
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100/80">
              {ILLUSTRATIVE_SOLAR_SAMPLE.label}
            </p>
            <h2 id="illustrative-sample-title" className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {ILLUSTRATIVE_SOLAR_SAMPLE.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-100/90">
              {ILLUSTRATIVE_SOLAR_SAMPLE.disclaimer}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <SampleMetric label="System range" value={ILLUSTRATIVE_SOLAR_SAMPLE.systemRange} />
              <SampleMetric label="Production" value={ILLUSTRATIVE_SOLAR_SAMPLE.productionRange} />
              <SampleMetric label="Modeled savings" value={ILLUSTRATIVE_SOLAR_SAMPLE.savingsRange} />
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {ILLUSTRATIVE_SOLAR_SAMPLE.factors.map((factor) => (
              <div key={factor.title} className="rounded-[0.95rem] border border-white/10 bg-white/[0.035] p-3">
                <h3 className="text-sm font-semibold text-white">{factor.title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/58">{factor.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-white/48">
              Your result will be preliminary and uses your roof, bill, and utility inputs.
            </p>
            <Link
              href="#address-estimate"
              onClick={handleContinue}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-cyan-200 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-white"
            >
              See my starting point
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SampleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.95rem] border border-white/10 bg-black/25 px-3 py-3">
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-white/50">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
