"use client";

import type { FollowUpStep } from "@/lib/follow-ups";

type FollowUpTimelineProps = {
  steps: FollowUpStep[];
  title?: string;
  subtitle?: string;
};

function formatScheduledFor(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FollowUpTimeline({
  steps,
  title = "Follow-up sequence",
  subtitle = "The homeowner gets an immediate report, then a short nurture sequence that keeps momentum going.",
}: FollowUpTimelineProps) {
  return (
    <section className="glass-panel rounded-[2rem] p-6">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
          Lead nurture
        </p>
        <h4 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          {title}
        </h4>
        <p className="mt-3 text-sm leading-7 text-slate-300">{subtitle}</p>
      </div>

      <div className="mt-6 grid gap-3">
        {steps.map((step) => (
          <article
            key={`${step.stepOrder}-${step.channel}`}
            className="rounded-[1.35rem] border border-white/10 bg-slate-950/35 p-4 shadow-[0_16px_40px_rgba(2,8,20,0.26)]"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-cyan-300">
                  <span className="h-2 w-2 rounded-full bg-cyan-300" />
                  {step.channel}
                </div>
                <h5 className="mt-2 text-lg font-semibold tracking-tight text-white">
                  {step.title}
                </h5>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {step.message}
                </p>
              </div>

              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span
                  className={`rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.28em] ${getStatusTone(
                    step.status
                  )}`}
                >
                  {step.status}
                </span>
                <span className="text-xs uppercase tracking-[0.28em] text-slate-400">
                  {formatScheduledFor(step.scheduledFor)}
                </span>
                {step.deliveryMessage ? (
                  <p className="max-w-xs text-right text-xs leading-5 text-slate-400">
                    {step.deliveryMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getStatusTone(status: FollowUpStep["status"]) {
  switch (status) {
    case "sent":
      return "border-emerald-300/20 bg-emerald-300/10 text-emerald-200";
    case "failed":
      return "border-rose-300/20 bg-rose-300/10 text-rose-200";
    case "skipped":
      return "border-amber-300/20 bg-amber-300/10 text-amber-200";
    case "scheduled":
    case "queued":
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}
