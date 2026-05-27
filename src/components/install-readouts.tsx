"use client";

import { useEffect, useState } from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";

const scanLog = [
  "Detecting roof edge...",
  "Measuring usable area...",
  "Mapping panel rows...",
  "Checking shade exposure...",
  "Confirming final placement...",
] as const;

type InstallReadoutsProps = {
  selectedAddress?: string;
  analysis: RoofAnalysis | null;
};

export function InstallReadouts({
  selectedAddress,
  analysis,
}: InstallReadoutsProps) {
  const [logIndex, setLogIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLogIndex((current) => (current + 1) % scanLog.length);
    }, 1200);

    return () => window.clearInterval(timer);
  }, []);

  if (!selectedAddress || !analysis) {
    return null;
  }

  return (
    <section className="relative mx-auto w-full max-w-7xl px-6 pb-8 md:px-10 lg:px-12">
      <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
        <article className="glass-panel h-full rounded-[1.75rem] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            AI scan
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
            Roof geometry looks install-ready.
          </h3>
          <p className="mt-2 text-xs uppercase tracking-[0.28em] text-slate-400">
            {selectedAddress}
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-3">
              <span className="text-slate-400">Roof slope</span>
              <span className="font-semibold text-white">
                {analysis.pitchDeg.toFixed(1)} deg
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-3">
              <span className="text-slate-400">Usable area</span>
              <span className="font-semibold text-white">
                {analysis.usablePctRoof}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Shade risk</span>
              <span className="font-semibold capitalize text-cyan-300">
                {analysis.shadingRisk}
              </span>
            </div>
          </div>
          <p
            className="mt-4 text-xs leading-6 text-slate-400"
            title="This is a modeled estimate. Your final report will include measurements specific to your roof."
          >
            {analysis.source === "vision-api"
              ? analysis.confidenceNote
              : "Estimated based on typical Arizona rooftops."}
          </p>
        </article>

        <article className="glass-panel h-full rounded-[1.75rem] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Status log
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
            Scanning the roof layout.
          </h3>
          <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
              <span className="typed-status">{scanLog[logIndex]}</span>
            </div>
            <p className="mt-3 text-xs leading-6 text-slate-400">
              The scan checks the roof edge, open area, and final panel position before the layout is approved.
            </p>
          </div>
        </article>

        <article className="glass-panel h-full rounded-[1.75rem] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Final placement
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">
            Panels on the garage roof plane.
          </h3>
          <p className="mt-2 text-xs uppercase tracking-[0.28em] text-slate-400">
            Matched to {selectedAddress}
          </p>
          <div className="mt-5 rounded-[1.25rem] border border-white/8 bg-slate-950/35 p-4">
            <div className="grid gap-2">
              {analysis.roofSegments.slice(0, 3).map((segment) => (
                <div key={segment.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.24em] text-slate-400">
                    <span>{segment.label}</span>
                    <span>{segment.panelsFit} panels</span>
                  </div>
                  <div className="h-3 rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#38bdf8)]"
                      style={{
                        width: `${Math.max(
                          18,
                          Math.min(
                            100,
                            Math.round(
                              (segment.panelsFit / Math.max(analysis.panelCount, 1)) * 100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {analysis.shadeNote}
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
