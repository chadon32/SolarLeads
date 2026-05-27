"use client";

import { useEffect, useRef, useState } from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";

type Stat = {
  label: string;
  suffix: string;
  value: number;
  description: string;
};

function useCountUp(target: number, start: boolean, duration = 1800) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) {
      const resetHandle = window.setTimeout(() => setValue(0), 0);
      return () => window.clearTimeout(resetHandle);
    }

    const startTime = performance.now();
    const interval = window.setInterval(() => {
      const progress = Math.min((performance.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = target * eased;
      setValue(Math.round(next));

      if (progress >= 1) {
        window.clearInterval(interval);
      }
    }, 16);

    return () => window.clearInterval(interval);
  }, [duration, start, target]);

  return value;
}

function AnimatedValue({
  stat,
  start,
}: {
  stat: Stat;
  start: boolean;
}) {
  const value = useCountUp(stat.value, start, 1700);
  const displayValue = start ? value : stat.value;

  return (
    <div className="glass-panel relative overflow-hidden rounded-[1.75rem] p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
        {stat.label}
      </p>
      <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-slate-950/35 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-end gap-2">
          <span className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {displayValue.toLocaleString()}
          </span>
          <span className="pb-1 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
            {stat.suffix}
          </span>
        </div>
      </div>
      <p className="mt-3 max-w-xs text-sm leading-6 text-slate-300">
        {stat.description}
      </p>
    </div>
  );
}

type SavingsStatsProps = {
  selectedAddress?: string;
  analysis: RoofAnalysis | null;
};

export function SavingsStats({
  selectedAddress,
  analysis,
}: SavingsStatsProps) {
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedAddress || !sectionRef.current) {
      setShouldAnimate(false);
      return;
    }

    const node = sectionRef.current;
    const triggerIfVisible = () => {
      if (shouldAnimate) {
        return true;
      }

      const rect = node.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const visibleHeight =
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);

      if (visibleHeight >= rect.height * 0.3) {
        setShouldAnimate(true);
        return true;
      }

      return false;
    };

    const initialCheckHandle = window.requestAnimationFrame(() => {
      triggerIfVisible();
    });
    const fallbackHandle = window.setTimeout(() => {
      setShouldAnimate(true);
    }, 2200);

    const handleScroll = () => {
      if (triggerIfVisible()) {
        window.removeEventListener("scroll", handleScroll);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldAnimate(true);
          window.removeEventListener("scroll", handleScroll);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(node);

    return () => {
      window.cancelAnimationFrame(initialCheckHandle);
      window.clearTimeout(fallbackHandle);
      window.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [selectedAddress, shouldAnimate]);

  if (!selectedAddress || !analysis) {
    return null;
  }

  const coverage = Math.min(
    96,
    Math.max(54, Math.round(analysis.systemKw * 7.3))
  );
  const carbonOffset = Math.round(analysis.annualKwh * 1.54);

  const stats: Stat[] = [
    {
      label: "Annual savings",
      suffix: "/yr",
      value: analysis.annualSavingsUSD,
      description: "Modeled annual utility savings for this address.",
    },
    {
      label: "Coverage",
      suffix: "%",
      value: coverage,
      description: "Estimated portion of household usage offset by the array.",
    },
    {
      label: "Carbon offset",
      suffix: " lbs",
      value: carbonOffset,
      description: "Modeled yearly CO2 reduction based on this address estimate.",
    },
  ];

  return (
    <section className="relative mx-auto w-full max-w-7xl px-6 pb-8 md:px-10 lg:px-12">
      <div
        ref={sectionRef}
        className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] px-6 py-6 shadow-[0_24px_70px_rgba(2,8,20,0.42)] backdrop-blur-xl md:px-8"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_45%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Energy impact
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Modeled savings and impact for this roof.
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
              These are modeled estimates based on the selected Arizona address and typical solar production.
            </p>
            <div className="mt-4">
              <span
                className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-cyan-200"
                title="This is a modeled estimate. Your final report will include measurements specific to your roof."
              >
                Modeled estimate - updates with your address
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:flex-1 lg:grid-cols-3">
            {stats.map((stat) => (
              <AnimatedValue key={stat.label} stat={stat} start={shouldAnimate} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
