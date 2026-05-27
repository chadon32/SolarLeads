"use client";

import { useEffect, useState } from "react";

type AnalysisSequenceProps = {
  address?: string;
};

const steps = [
  "Analyzing roof geometry...",
  "Calculating solar exposure...",
  "Estimating energy savings...",
] as const;

export function AnalysisSequence({ address }: AnalysisSequenceProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!address) return;

    const resetHandle = window.requestAnimationFrame(() => setStepIndex(0));
    const timers = [
      window.setTimeout(() => setStepIndex(1), 1100),
      window.setTimeout(() => setStepIndex(2), 2200),
      window.setTimeout(() => setStepIndex(3), 3400),
    ];

    return () => {
      window.cancelAnimationFrame(resetHandle);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [address]);

  if (!address) {
    return null;
  }

  const complete = stepIndex >= steps.length;

  return (
    <div className="relative mt-5 overflow-hidden rounded-[1.5rem] border border-cyan-300/14 bg-[linear-gradient(135deg,rgba(10,15,24,0.96),rgba(7,11,18,0.88))] p-5 shadow-[0_18px_60px_rgba(2,8,20,0.34)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.14),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_32%)]" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            AI analysis
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {complete ? "Roof scan ready." : address}
          </h3>
        </div>
        <div className="h-12 w-12 rounded-full border border-cyan-300/20 bg-cyan-300/10 shadow-[0_0_30px_rgba(103,232,249,0.18)]">
          <div className="analysis-orbit h-full w-full rounded-full" />
        </div>
      </div>

      <div className="relative mt-5 grid gap-3">
        {steps.map((step, index) => {
          const active = index === stepIndex;
          const done = index < Math.min(stepIndex, steps.length);

          return (
            <div
              key={step}
              className={`flex items-center gap-3 rounded-[1rem] border px-4 py-3 text-sm transition ${
                active
                  ? "border-cyan-300/20 bg-white/8 text-white shadow-[0_10px_30px_rgba(2,8,20,0.24)]"
                  : done
                    ? "border-white/8 bg-white/5 text-slate-300"
                    : "border-white/6 bg-transparent text-slate-500"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  active
                    ? "bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]"
                    : done
                      ? "bg-emerald-300"
                      : "bg-slate-600"
                }`}
              />
              <span className="font-medium">{step}</span>
              {active ? (
                <span className="ml-auto text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-300">
                  Working
                </span>
              ) : done ? (
                <span className="ml-auto text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-emerald-300">
                  Done
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {complete ? (
        <div className="relative mt-4 rounded-[1.2rem] border border-emerald-300/16 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-200">
          Ready to place panels on the strongest roof plane.
        </div>
      ) : null}
    </div>
  );
}
