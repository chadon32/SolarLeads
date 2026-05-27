"use client";

import { useEffect, useState } from "react";

type Stat = {
  label: string;
  suffix: string;
  value: number;
  decimals?: number;
  description: string;
};

const stats: Stat[] = [
  {
    label: "Annual savings",
    suffix: "/yr",
    value: 3240,
    description: "Estimated utility savings from solar production.",
  },
  {
    label: "Coverage",
    suffix: "%",
    value: 86,
    description: "Portion of household energy offset by the array.",
  },
  {
    label: "Carbon offset",
    suffix: " lbs",
    value: 8120,
    description: "Approximate annual CO2 reduction impact.",
  },
];

function useCountUp(target: number, duration = 1800, decimals = 0) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = target * eased;
      setValue(Number(next.toFixed(decimals)));

      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [decimals, duration, target]);

  return value;
}

function AnimatedValue({ stat }: { stat: Stat }) {
  const value = useCountUp(stat.value, 1700, stat.decimals ?? 0);

  return (
    <div className="glass-panel relative overflow-hidden rounded-[1.75rem] p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
      <div className="flex items-center gap-1 text-cyan-300/70">
        <span className="h-px w-4 bg-current" />
        <span className="h-px w-2 bg-current" />
        <span className="h-px w-6 bg-current" />
        <span className="h-px w-2 bg-current" />
        <span className="h-px w-4 bg-current" />
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
        {stat.label}
      </p>
      <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-slate-950/35 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-end gap-2">
          <span className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {value.toLocaleString()}
          </span>
          <span className="pb-1 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
            {stat.suffix}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1 text-cyan-300/40">
          <span className="h-px w-full bg-current" />
          <span className="text-[0.65rem] font-semibold uppercase tracking-[0.28em]">
            --
          </span>
          <span className="h-px w-full bg-current" />
        </div>
      </div>
      <p className="mt-3 max-w-xs text-sm leading-6 text-slate-300">
        {stat.description}
      </p>
    </div>
  );
}

export function SavingsStats() {
  return (
    <section className="relative mx-auto w-full max-w-7xl px-6 pb-8 md:px-10 lg:px-12">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] px-6 py-6 shadow-[0_24px_70px_rgba(2,8,20,0.42)] backdrop-blur-xl md:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.02)_45%,transparent_70%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Energy impact
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Modelled savings and impact for this roof.
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
              These counters ease in after the scan sequence so the experience
              feels like a premium estimate rather than a static mockup.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-cyan-200">
                Modeled estimate
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
                Updated after scan
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:flex-1 lg:grid-cols-3">
            {stats.map((stat) => (
              <AnimatedValue key={stat.label} stat={stat} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
