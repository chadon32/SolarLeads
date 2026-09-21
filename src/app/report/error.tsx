"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export default function ReportError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-12 text-white sm:px-6">
      <section className="mx-auto max-w-xl rounded-[1.5rem] border border-white/10 bg-white/[0.055] p-8 text-center shadow-[0_18px_70px_rgba(2,8,20,0.32)]">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
          Report unavailable
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          We could not load this report.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          The link may be invalid, expired, or temporarily unavailable. Please
          request a fresh report link or return to {APP_NAME}.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full border border-white/10 bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.14]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            Back to {APP_NAME}
          </Link>
        </div>
      </section>
    </main>
  );
}
