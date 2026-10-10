import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[80svh] max-w-2xl items-center px-5 py-12">
      <section className="w-full rounded-card border border-white/10 bg-slate-950/80 p-6 sm:p-10">
        <p className="text-xs font-semibold text-sky-200">Solartelligence / 404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink">We couldn&apos;t find that page.</h1>
        <p className="mt-4 text-base leading-7 text-slate-300">
          The link may be incomplete or the page may have moved. Return home to start or continue your roof analysis.
        </p>
        <Link href="/" className="btn btn-primary mt-6 min-h-11 px-6 py-3">
          Back to Solartelligence
        </Link>
      </section>
    </main>
  );
}
