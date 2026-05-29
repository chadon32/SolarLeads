import type { Metadata } from "next";
import { Button, ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Homeowner Dashboard",
  description:
    "Operational status for Arizona Solar AI report delivery, privacy mode, and deployment configuration.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const token = (await searchParams)?.token?.trim();
  const accessToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();

  if (process.env.NODE_ENV === "production" && !accessToken) {
    return <DashboardAccessGate configurationMissing />;
  }

  if (accessToken && token !== accessToken) {
    return <DashboardAccessGate />;
  }

  const reportEmailReady = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim()
  );
  const mapsReady = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const solarReady = Boolean(
    process.env.GOOGLE_SOLAR_API_KEY?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_SOLAR_API_KEY?.trim()
  );
  const supabaseConfigured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );

  const checks = [
    {
      label: "PDF email delivery",
      status: reportEmailReady ? "Ready" : "Needs Resend env",
      tone: reportEmailReady ? "good" : "warn",
      detail: reportEmailReady
        ? "Reports are generated as PDF attachments and sent through Resend."
        : "Set RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel to send report PDFs.",
    },
    {
      label: "Lead storage",
      status: "Off",
      tone: "good",
      detail:
        "The public report flow does not save homeowner leads to Supabase by design.",
    },
    {
      label: "Google Maps",
      status: mapsReady ? "Ready" : "Missing key",
      tone: mapsReady ? "good" : "warn",
      detail: mapsReady
        ? "Address search and rooftop map rendering can use the browser Maps key."
        : "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for address and map functionality.",
    },
    {
      label: "Google Solar API",
      status: solarReady ? "Ready" : "Missing key",
      tone: solarReady ? "good" : "warn",
      detail: solarReady
        ? "Roof model, sunlight, and panel candidate data can be requested."
        : "Set GOOGLE_SOLAR_API_KEY for production Solar API calls.",
    },
    {
      label: "Supabase utilities",
      status: supabaseConfigured ? "Available" : "Optional",
      tone: "neutral",
      detail: supabaseConfigured
        ? "Supabase can still support caching, rate limits, or legacy admin tools."
        : "Supabase lead tables are no longer required for the public report flow.",
    },
  ] satisfies Array<{
    detail: string;
    label: string;
    status: string;
    tone: "good" | "neutral" | "warn";
  }>;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),radial-gradient(circle_at_80%_20%,_rgba(0,182,255,0.16),_transparent_26%),linear-gradient(180deg,#05070d_0%,#07111d_36%,#0b1625_68%,#06070b_100%)] text-slate-100">
      <section className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 lg:px-12">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Homeowner dashboard
            </p>
            <h1 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Report delivery and privacy status.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              The site now sends PDF reports by email without storing homeowner
              leads. This dashboard shows whether the production services are ready.
            </p>
          </div>
          <ButtonLink href="/" variant="secondary" className="px-5 py-3 text-sm">
            Back home
          </ButtonLink>
        </header>

        <dl className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Lead records"
            value="0"
            helper="No public submissions are saved as leads."
          />
          <StatCard
            label="Report mode"
            value="PDF email"
            helper="Reports are sent as attachments."
          />
          <StatCard
            label="Privacy mode"
            value="On"
            helper="Email is used for delivery only."
          />
        </dl>

        <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="glass-panel rounded-[2rem] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                  Deployment checks
                </p>
                <h2 className="mt-2 max-w-xl text-balance text-2xl font-semibold tracking-tight text-white">
                  Production readiness for report delivery.
                </h2>
              </div>
              <span className="inline-flex self-start rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-emerald-200">
                No lead storage
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              {checks.map((check) => (
                <StatusRow key={check.label} {...check} />
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[2rem] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Current workflow
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              Address in, PDF out.
            </h3>
            <div className="mt-6 grid gap-3">
              {[
                "Homeowner selects an Arizona address.",
                "Google Solar API returns the roof model.",
                "The report dashboard renders on the page.",
                "The homeowner enters email and monthly bill.",
                "A PDF is generated and emailed without saving a lead record.",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-[1.1rem] border border-white/8 bg-slate-950/32 px-4 py-3 text-sm text-slate-300"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-cyan-200/20 bg-cyan-200/10 text-[0.7rem] font-semibold text-cyan-100">
                    {index + 1}
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function DashboardAccessGate({
  configurationMissing = false,
}: {
  configurationMissing?: boolean;
}) {
  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-8 text-slate-100 sm:px-6 md:px-10 lg:px-12">
      <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
          Homeowner dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          {configurationMissing ? "Dashboard is not configured." : "Access required."}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          {configurationMissing
            ? "Set DASHBOARD_ACCESS_TOKEN in Vercel before using this dashboard in production."
            : "Enter the dashboard access token to view report delivery status."}
        </p>

        {configurationMissing ? null : (
          <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              name="token"
              type="password"
              placeholder="Dashboard token"
              className="flex-1 rounded-[1.1rem] border border-white/10 bg-slate-950/45 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
            />
            <Button type="submit" className="px-5 py-3 text-sm">
              Unlock dashboard
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="glass-panel rounded-[1.75rem] p-5">
      <dt className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
        {label}
      </dt>
      <dd className="mt-3 text-3xl font-semibold tracking-tight text-white">
        {value}
      </dd>
      <p className="mt-2 text-sm leading-6 text-slate-300">{helper}</p>
    </div>
  );
}

function StatusRow({
  detail,
  label,
  status,
  tone,
}: {
  detail: string;
  label: string;
  status: string;
  tone: "good" | "neutral" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
      : tone === "warn"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-white/10 bg-white/5 text-slate-200";

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.25)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p>
        </div>
        <span
          className={`inline-flex self-start rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] ${toneClass}`}
        >
          {status}
        </span>
      </div>
    </article>
  );
}
