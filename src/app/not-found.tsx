import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[80svh] max-w-2xl items-center px-5 py-12">
      <section className="w-full rounded-3xl border border-white/10 bg-slate-950/80 p-6 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Solartelligence / 404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">We couldn&apos;t find that page.</h1>
        <p className="mt-4 text-base leading-7 text-slate-300">
          The link may be incomplete or the page may have moved. Return home to start or continue your roof analysis.
        </p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-200 px-6 py-3 font-semibold text-slate-950 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">
          Back to Solartelligence
        </Link>
      </section>
    </main>
  );
}
