import type { Metadata } from "next";
import Link from "next/link";
import { APP_CANONICAL_URL, APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Estimate Terms",
  description: `Important limitations for ${APP_NAME} solar estimates.`,
  alternates: { canonical: `${APP_CANONICAL_URL}/terms` },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_32%),#05070b] px-5 py-12 text-slate-100 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-[1.5rem] border border-white/10 bg-slate-950/72 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
          {APP_NAME}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Estimate terms</h1>
        <p className="mt-5 text-sm leading-7 text-slate-300">
          Solartelligence reports are preliminary educational estimates based on
          available satellite, solar, property, and homeowner-provided data.
          They are not engineering plans, installation contracts, financing
          offers, tax advice, or guarantees.
        </p>
        <ul className="mt-7 grid gap-4 text-sm leading-7 text-slate-300">
          <li className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            Roof condition, structure, setbacks, electrical service, equipment,
            placement, and production require installer verification.
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            Pricing, utility tariffs, export compensation, fixed charges,
            incentives, financing approval, APR, fees, and tax eligibility may
            change and must be confirmed before purchase.
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            Savings and payback are modeled outcomes, not promised utility-bill
            reductions or investment returns.
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            Requesting a report does not require you to request installer contact.
            Installer/admin notification occurs only when that separate option is
            selected.
          </li>
        </ul>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-full bg-cyan-100 px-5 py-3 text-sm font-semibold text-slate-950"
          >
            Back to {APP_NAME}
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center rounded-full border border-white/12 px-5 py-3 text-sm font-semibold text-white"
          >
            Privacy notice
          </Link>
        </div>
      </article>
    </main>
  );
}
