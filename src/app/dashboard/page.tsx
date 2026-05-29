import type { Metadata } from "next";
import { FollowUpTimeline } from "@/components/follow-up-timeline";
import { Button, ButtonLink } from "@/components/ui/button";
import { buildSolarReportFromSolarValues } from "@/lib/solar-report";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import type { FollowUpStep } from "@/lib/follow-ups";
import { buildReportPdfPath } from "@/lib/report-access";

export const metadata: Metadata = {
  title: "Homeowner Dashboard",
  description:
    "Saved leads, solar report history, downloadable PDFs, and follow-up status for Arizona homeowners.",
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

  const supabase = getSupabaseAdminClient();

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, address, monthly_bill, estimated_savings, panel_count, system_size_kw, annual_savings, annual_energy_kwh, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (leadsError) {
    return (
      <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-6 py-10 text-slate-100 md:px-10 lg:px-12">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
            Homeowner dashboard
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Dashboard data is not ready yet.
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Make sure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the Supabase
            SQL files for `leads`, `lead_followups`, and `request_events` are all
            configured in the same project, then refresh this page.
          </p>
          <p className="mt-3 rounded-[1.1rem] border border-white/10 bg-slate-950/40 px-4 py-3 text-xs leading-6 text-slate-300">
            If Vercel is pointed at the wrong Supabase project, or the `leads`
            table was not created there, this page will show the setup warning
            instead of the data view.
          </p>
        </div>
      </main>
    );
  }

  const { data: followUps, error: followUpsError } = await supabase
    .from("lead_followups")
    .select(
      "id, lead_id, step_order, channel, title, body, scheduled_for, status, attempts, processed_at, delivery_message"
    )
    .order("scheduled_for", { ascending: false })
    .limit(30);

  const leadList = leads ?? [];
  const followUpList = followUpsError ? [] : followUps ?? [];
  const totalLeads = leadList.length;
  const totalSavings = leadList.reduce((sum, lead) => sum + (lead.estimated_savings || 0), 0);
  const averageSavings = totalLeads ? Math.round(totalSavings / totalLeads) : 0;
  const queuedFollowUps = followUpList.filter((item) => item.status === "queued").length;

  const followUpSteps: FollowUpStep[] = followUpList.map((item) => ({
    stepOrder: item.step_order,
    channel: item.channel,
    title: item.title,
    message: item.body,
    scheduledFor: item.scheduled_for,
    status: item.status as FollowUpStep["status"],
    attempts: item.attempts ?? 0,
    processedAt: item.processed_at ?? null,
    deliveryMessage: item.delivery_message ?? null,
  }));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),radial-gradient(circle_at_80%_20%,_rgba(0,182,255,0.16),_transparent_26%),linear-gradient(180deg,#05070d_0%,#07111d_36%,#0b1625_68%,#06070b_100%)] text-slate-100">
      <section className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 lg:px-12">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Homeowner dashboard
            </p>
            <h1 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Lead history, report PDFs, and follow-up status.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              This is the saved homeowner view for recent solar inquiries. Each row can
              download the report PDF and shows the modeled savings behind the lead.
            </p>
          </div>
          <ButtonLink href="/" variant="secondary" className="px-5 py-3 text-sm">
            Back home
          </ButtonLink>
        </header>

        <dl className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Recent leads" value={totalLeads.toString()} helper="Last 10 saved homeowner leads." />
          <StatCard label="Avg. savings" value={formatMoney(averageSavings)} helper="Average modeled annual savings." />
          <StatCard label="Queued follow-ups" value={queuedFollowUps.toString()} helper="Email and SMS sequence records." />
        </dl>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="glass-panel rounded-[2rem] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                  Lead archive
                </p>
                <h2 className="mt-2 max-w-xl text-balance text-2xl font-semibold tracking-tight text-white">
                  Recent homeowner reports.
                </h2>
              </div>
              <span className="inline-flex self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-slate-300">
                PDF ready
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              {leadList.map((lead) => {
                const report = buildSolarReportFromSolarValues({
                  annualSavings: Number(lead.annual_savings ?? lead.estimated_savings ?? 0),
                  annualKwh: Number(lead.annual_energy_kwh ?? 0),
                  panelCount: Number(lead.panel_count ?? 0),
                  systemKw: Number(lead.system_size_kw ?? 0),
                  monthlyBill: Number(lead.monthly_bill),
                });

                return (
                  <article
                    key={lead.id}
                    className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-4 shadow-[0_18px_50px_rgba(2,8,20,0.25)] sm:p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                          {new Date(lead.created_at).toLocaleDateString("en-US")}
                        </p>
                        <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                          {lead.name}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          {lead.address}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.28em] text-slate-400">
                          {lead.email} | {lead.phone}
                        </p>
                      </div>
                      <ButtonLink
                        href={buildReportPdfPath(lead.id)}
                        variant="primary"
                        className="w-full px-5 py-3 text-sm md:w-auto"
                      >
                        Download PDF
                      </ButtonLink>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <SmallMetric label="Annual savings" value={formatMoney(report.annualSavings)} />
                      <SmallMetric label="ROI" value={`${report.estimatedRoiYears} years`} />
                      <SmallMetric label="CO2 offset" value={`${report.annualImpactLbs.toLocaleString()} lbs`} />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          {followUpSteps.length ? (
            <FollowUpTimeline
              steps={followUpSteps}
              title="Follow-up and nurture sequence"
              subtitle="Each lead now has a lightweight nurture path. The first report is instant, and the rest of the sequence keeps the homeowner warm."
            />
          ) : (
            <div className="glass-panel rounded-[2rem] p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
                Lead nurture
              </p>
              <h4 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Follow-up records are empty for now.
              </h4>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Run the `supabase/lead_followups.sql` script, submit a lead, and this
                panel will show the email and SMS sequence.
              </p>
              {followUpsError ? (
                <p className="mt-3 text-xs uppercase tracking-[0.28em] text-slate-400">
                  Follow-up table not available yet.
                </p>
              ) : null}
            </div>
          )}
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
            ? "Set DASHBOARD_ACCESS_TOKEN in Vercel to protect lead history before using this dashboard in production."
            : "Enter the dashboard access token to view lead history, PDF links, and follow-up status."}
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

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
