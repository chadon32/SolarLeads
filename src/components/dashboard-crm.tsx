"use client";

import {
  startTransition,
  type ReactNode,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  Filter,
  Mail,
  MapPin,
  Phone,
  Search,
  TrendingUp,
  UserRound,
  Workflow,
} from "lucide-react";

export type DashboardLeadStatus =
  | "new"
  | "contacted"
  | "follow-up-due"
  | "closed";

export type DashboardCrmLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  annualSavings: number;
  co2OffsetLbs: number;
  estimatedRoiYears: number;
  panelCount: number;
  systemSizeKw: number;
  reportUrl: string;
  status: DashboardLeadStatus;
  pdfStatus: "ready";
};

export type DashboardCrmFollowUp = {
  id: string;
  leadId: string;
  stepOrder: number;
  channel: string;
  title: string;
  message: string;
  scheduledFor: string;
  status: "queued" | "scheduled" | "sent" | "failed" | "skipped";
  attempts: number;
  processedAt: string | null;
  deliveryMessage: string | null;
};

export type DashboardCrmStats = {
  totalLeads: number;
  averageSavings: number;
  queuedFollowUps: number;
  pdfsGenerated: number;
  conversionRate: number | null;
};

type DashboardCrmProps = {
  leads: DashboardCrmLead[];
  followUps: DashboardCrmFollowUp[];
  stats: DashboardCrmStats;
};

type SortMode = "date-desc" | "date-asc" | "savings-desc" | "savings-asc";
type StatusFilter = "all" | DashboardLeadStatus;

export function DashboardCrm({ leads, followUps, stats }: DashboardCrmProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    leads[0]?.id ?? null
  );

  const filteredLeads = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();

    return leads
      .filter((lead) => {
        const matchesSearch =
          !normalizedSearch ||
          [
            lead.name,
            lead.address,
            lead.email,
            lead.phone,
            formatMoney(lead.annualSavings),
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);
        const matchesStatus =
          statusFilter === "all" || lead.status === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        if (sortMode === "date-asc") {
          return (
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime()
          );
        }

        if (sortMode === "savings-desc") {
          return right.annualSavings - left.annualSavings;
        }

        if (sortMode === "savings-asc") {
          return left.annualSavings - right.annualSavings;
        }

        return (
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
        );
      });
  }, [deferredSearch, leads, sortMode, statusFilter]);

  const effectiveSelectedLeadId =
    selectedLeadId && filteredLeads.some((lead) => lead.id === selectedLeadId)
      ? selectedLeadId
      : filteredLeads[0]?.id ?? null;
  const selectedLead =
    leads.find((lead) => lead.id === effectiveSelectedLeadId) ?? null;
  const selectedFollowUps = useMemo(
    () =>
      selectedLead
        ? followUps
            .filter((followUp) => followUp.leadId === selectedLead.id)
            .sort(
              (left, right) =>
                new Date(right.scheduledFor).getTime() -
                new Date(left.scheduledFor).getTime()
            )
        : [],
    [followUps, selectedLead]
  );

  const selectedFollowUpStatus = getFollowUpSummary(selectedFollowUps);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.3),_transparent_36%),radial-gradient(circle_at_80%_20%,_rgba(0,182,255,0.16),_transparent_26%),linear-gradient(180deg,#05070d_0%,#07111d_36%,#0b1625_68%,#06070b_100%)] text-slate-100">
      <section className="page-enter mx-auto flex w-full max-w-[92rem] flex-col gap-4 px-4 py-5 sm:px-6 md:px-8 xl:px-10">
        <header className="flex flex-col gap-4 rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_24px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Homeowner dashboard
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Solar lead command center.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Manage saved homeowner reports, follow-up state, and PDF access from one compact CRM surface.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-cyan-200/30 hover:bg-cyan-200/10"
          >
            Back home
          </Link>
        </header>

        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Total leads"
            value={stats.totalLeads.toString()}
            helper="Saved homeowner reports"
            icon={<UserRound className="h-4 w-4" />}
          />
          <KpiCard
            label="Avg savings"
            value={formatMoney(stats.averageSavings)}
            helper="Modeled annual value"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiCard
            label="Queued follow-ups"
            value={stats.queuedFollowUps.toString()}
            helper="Pending nurture tasks"
            icon={<Clock3 className="h-4 w-4" />}
          />
          <KpiCard
            label="PDFs generated"
            value={stats.pdfsGenerated.toString()}
            helper="Downloadable reports"
            icon={<FileText className="h-4 w-4" />}
          />
          <KpiCard
            label="Conversion rate"
            value={
              stats.conversionRate === null
                ? "N/A"
                : `${Math.round(stats.conversionRate)}%`
            }
            helper="Closed data not connected"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </dl>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(330px,3fr)]">
          <div className="min-w-0 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_24px_70px_rgba(2,8,20,0.28)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.32em] text-cyan-300">
                  Lead management
                </p>
                <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-white">
                  Recent homeowner reports
                </h2>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px_170px] lg:w-[640px]">
                <label className="relative">
                  <span className="sr-only">Search leads</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(event) =>
                      startTransition(() => setSearch(event.target.value))
                    }
                    placeholder="Search leads, address, email..."
                    className="h-10 w-full rounded-full border border-white/10 bg-slate-950/35 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-slate-950/55"
                  />
                </label>

                <label className="relative">
                  <span className="sr-only">Filter by status</span>
                  <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      startTransition(() =>
                        setStatusFilter(event.target.value as StatusFilter)
                      )
                    }
                    className="h-10 w-full appearance-none rounded-full border border-white/10 bg-slate-950/35 pl-9 pr-3 text-sm text-white outline-none transition focus:border-cyan-300/35"
                  >
                    <option value="all">All statuses</option>
                    <option value="new">New lead</option>
                    <option value="follow-up-due">Follow-up due</option>
                    <option value="contacted">Contacted</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>

                <label>
                  <span className="sr-only">Sort leads</span>
                  <select
                    value={sortMode}
                    onChange={(event) =>
                      startTransition(() =>
                        setSortMode(event.target.value as SortMode)
                      )
                    }
                    className="h-10 w-full rounded-full border border-white/10 bg-slate-950/35 px-3 text-sm text-white outline-none transition focus:border-cyan-300/35"
                  >
                    <option value="date-desc">Newest first</option>
                    <option value="date-asc">Oldest first</option>
                    <option value="savings-desc">Savings high</option>
                    <option value="savings-asc">Savings low</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.2rem] border border-white/10 bg-slate-950/25">
              {filteredLeads.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                    <thead className="border-b border-white/10 bg-white/[0.04] text-[0.62rem] uppercase tracking-[0.24em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Address</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Annual savings</th>
                        <th className="px-4 py-3 font-semibold">CO2 offset</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8">
                      {filteredLeads.map((lead) => {
                        const selected = lead.id === selectedLead?.id;

                        return (
                          <tr
                            key={lead.id}
                            onClick={() => setSelectedLeadId(lead.id)}
                            aria-selected={selected}
                            className={`cursor-pointer transition hover:bg-cyan-300/[0.07] ${
                              selected ? "bg-cyan-300/[0.1]" : "bg-transparent"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <InitialsAvatar name={lead.name} />
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-white">
                                    {lead.name}
                                  </p>
                                  <p className="truncate text-xs text-slate-400">
                                    {lead.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="max-w-[280px] px-4 py-3">
                              <p className="truncate text-slate-300">
                                {lead.address}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {formatDate(lead.createdAt)}
                            </td>
                            <td className="px-4 py-3 font-semibold text-white">
                              {formatMoney(lead.annualSavings)}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {lead.co2OffsetLbs.toLocaleString()} lbs
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={lead.status} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedLeadId(lead.id);
                                  }}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-200/30 hover:bg-cyan-200/10"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View
                                </button>
                                <a
                                  href={lead.reportUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/12 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  PDF
                                </a>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyLeadsState />
              )}
            </div>
          </div>

          <LeadDetailPanel
            lead={selectedLead}
            followUps={selectedFollowUps}
            followUpSummary={selectedFollowUpStatus}
          />
        </section>
      </section>
    </main>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-h-[118px] flex-col justify-between rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_46px_rgba(2,8,20,0.24)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-slate-400">
          {label}
        </dt>
        <span className="grid h-8 w-8 place-items-center rounded-full border border-cyan-300/15 bg-cyan-300/10 text-cyan-200">
          {icon}
        </span>
      </div>
      <dd className="mt-3 text-3xl font-semibold tracking-tight text-white">
        {value}
      </dd>
      <p className="mt-1 text-xs leading-5 text-slate-400">{helper}</p>
    </div>
  );
}

function LeadDetailPanel({
  lead,
  followUps,
  followUpSummary,
}: {
  lead: DashboardCrmLead | null;
  followUps: DashboardCrmFollowUp[];
  followUpSummary: string;
}) {
  if (!lead) {
    return (
      <aside className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl xl:sticky xl:top-5">
        <EmptyLeadsState compact />
      </aside>
    );
  }

  return (
    <aside className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_24px_70px_rgba(2,8,20,0.28)] backdrop-blur-xl xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
      <div className="flex items-start gap-3">
        <InitialsAvatar name={lead.name} large />
        <div className="min-w-0 flex-1">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Lead detail
          </p>
          <h3 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-white">
            {lead.name}
          </h3>
          <p className="mt-1 text-sm leading-5 text-slate-400">
            {formatDate(lead.createdAt)} submitted report
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge status={lead.status} />
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-emerald-200">
          PDF ready
        </span>
      </div>

      <div className="mt-5 grid gap-2.5 text-sm">
        <InfoLine icon={<MapPin className="h-4 w-4" />} label="Address" value={lead.address} />
        <InfoLine icon={<Phone className="h-4 w-4" />} label="Phone" value={lead.phone} />
        <InfoLine icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <DetailMetric
          label="Annual savings"
          value={formatMoney(lead.annualSavings)}
        />
        <DetailMetric
          label="System size"
          value={`${formatDecimal(lead.systemSizeKw)} kW`}
        />
        <DetailMetric
          label="Estimated ROI"
          value={lead.estimatedRoiYears ? `${lead.estimatedRoiYears} yrs` : "N/A"}
        />
        <DetailMetric
          label="CO2 offset"
          value={`${lead.co2OffsetLbs.toLocaleString()} lbs`}
        />
      </div>

      <div className="mt-5 grid gap-2">
        <a
          href={lead.reportUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/14 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/22"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </a>
        <a
          href={lead.reportUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-200/25 hover:bg-cyan-200/10"
        >
          <Eye className="h-4 w-4" />
          Open Report
        </a>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled
            title="CRM write actions are not connected yet."
            className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs font-semibold text-slate-500"
          >
            Mark Contacted
          </button>
          <button
            type="button"
            disabled
            title="Scheduling is not connected yet."
            className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs font-semibold text-slate-500"
          >
            Schedule Follow-up
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-slate-950/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-300">
              Follow-up status
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {followUpSummary}
            </p>
          </div>
          <CalendarClock className="h-5 w-5 text-cyan-200" />
        </div>

        {followUps.length ? (
          <div className="mt-4 grid gap-2">
            {followUps.slice(0, 4).map((followUp) => (
              <article
                key={followUp.id}
                className="rounded-[1rem] border border-white/8 bg-white/[0.035] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-white">
                    {followUp.title}
                  </p>
                  <FollowUpBadge status={followUp.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                  {followUp.message}
                </p>
                <p className="mt-2 text-[0.62rem] uppercase tracking-[0.22em] text-slate-500">
                  {followUp.channel} - {formatDateTime(followUp.scheduledFor)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <FollowUpEmptyState />
        )}
      </div>
    </aside>
  );
}

function InfoLine({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-[1rem] border border-white/8 bg-slate-950/25 px-3 py-2.5">
      <span className="mt-0.5 text-cyan-200">{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
          {label}
        </p>
        <p className="mt-1 break-words text-sm text-slate-200">{value}</p>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-lg font-semibold tracking-tight text-white">
        {value}
      </p>
    </div>
  );
}

function InitialsAvatar({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/12 font-semibold text-cyan-100 ${
        large ? "h-12 w-12 text-base" : "h-9 w-9 text-xs"
      }`}
    >
      {initials || "AI"}
    </span>
  );
}

function StatusBadge({ status }: { status: DashboardLeadStatus }) {
  const config = getLeadStatusConfig(status);

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function FollowUpBadge({
  status,
}: {
  status: DashboardCrmFollowUp["status"];
}) {
  const className =
    status === "sent"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
      : status === "failed"
        ? "border-rose-300/20 bg-rose-300/10 text-rose-200"
        : status === "skipped"
          ? "border-amber-300/20 bg-amber-300/10 text-amber-200"
          : "border-cyan-300/18 bg-cyan-300/10 text-cyan-100";

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.2em] ${className}`}
    >
      {status}
    </span>
  );
}

function FollowUpEmptyState() {
  return (
    <div className="mt-4 rounded-[1.1rem] border border-dashed border-white/14 bg-white/[0.03] p-4 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-cyan-300/18 bg-cyan-300/10 text-cyan-100">
        <Workflow className="h-5 w-5" />
      </div>
      <h4 className="mt-3 text-sm font-semibold text-white">
        No follow-ups scheduled yet
      </h4>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Create your first follow-up workflow to keep this homeowner warm.
      </p>
      <button
        type="button"
        disabled
        title="Workflow creation is not connected yet."
        className="mt-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-500"
      >
        Create Workflow
      </button>
    </div>
  );
}

function EmptyLeadsState({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`grid place-items-center text-center ${
        compact ? "min-h-[220px]" : "min-h-[320px] p-8"
      }`}
    >
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-cyan-300/18 bg-cyan-300/10 text-cyan-100">
          <UserRound className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-white">
          No leads match this view
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          Adjust search, filters, or submit a new homeowner report to populate the CRM table.
        </p>
      </div>
    </div>
  );
}

function getLeadStatusConfig(status: DashboardLeadStatus) {
  switch (status) {
    case "contacted":
      return {
        label: "Contacted",
        className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
      };
    case "follow-up-due":
      return {
        label: "Follow-up Due",
        className: "border-amber-300/20 bg-amber-300/10 text-amber-100",
      };
    case "closed":
      return {
        label: "Closed",
        className: "border-slate-300/20 bg-slate-300/10 text-slate-200",
      };
    case "new":
    default:
      return {
        label: "New Lead",
        className: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
      };
  }
}

function getFollowUpSummary(followUps: DashboardCrmFollowUp[]) {
  if (!followUps.length) return "No workflow scheduled";
  if (followUps.some((followUp) => followUp.status === "failed")) {
    return "Needs attention";
  }
  if (followUps.some((followUp) => followUp.status === "queued")) {
    return "Queued follow-up";
  }
  if (followUps.some((followUp) => followUp.status === "scheduled")) {
    return "Scheduled follow-up";
  }
  if (followUps.some((followUp) => followUp.status === "sent")) {
    return "Contacted";
  }
  return "Workflow reviewed";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "N/A";
  return value.toFixed(1);
}
