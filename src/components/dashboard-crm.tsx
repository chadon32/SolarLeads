"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CalendarDays, Download, Search, Send, SlidersHorizontal, UserRound } from "lucide-react";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import { formatName } from "@/lib/name-format";
import {
  LEAD_SCORE_EXPLANATION,
  type LeadScoreLabel,
} from "@/lib/lead-scoring";

export type DashboardLeadStatus =
  | "new"
  | "contacted"
  | "quoted"
  | "closed-won"
  | "closed-lost";

export type DashboardCrmLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  monthlyBill: number;
  createdAt: string;
  annualSavings: number;
  co2OffsetLbs: number;
  estimatedRoiYears: number;
  energyOffsetPct: number;
  panelCount: number;
  federalTaxCredit: number | null;
  netSystemCost: number | null;
  selectedInverterType: string | null;
  selectedPanelBrand: string | null;
  selectedPanelModel: string | null;
  selectedPanelWatts: number | null;
  systemCostBeforeIncentives: number | null;
  systemSizeKw: number;
  leadScore: number;
  leadScoreExplanation: string;
  leadScoreLabel: LeadScoreLabel;
  reportUrl: string;
  status: DashboardLeadStatus;
  pdfStatus: "ready" | "pending";
  utilityBillUploaded: boolean;
  smsSentAt: string | null;
  batteryAdded: boolean;
  batteryBrand: string | null;
  batteryModel: string | null;
  batteryCost: number | null;
  referralCode: string | null;
  referredBy: string | null;
  referralsMade: number;
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

type DashboardCrmProps = {
  leads: DashboardCrmLead[];
  followUps: DashboardCrmFollowUp[];
  stats: {
    totalLeads: number;
    averageSavings: number;
    averageLeadScore: number;
    queuedFollowUps: number;
    pdfsGenerated: number;
    averagePayback: number;
    conversionRate: number | null;
  };
};

const statusColumns: Array<{ id: DashboardLeadStatus; label: string }> = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "quoted", label: "Quote Requested" },
  { id: "closed-won", label: "Closed Won" },
  { id: "closed-lost", label: "Closed Lost" },
];

const sortOptions = [
  { label: "Newest", value: "newest" },
  { label: "Savings high", value: "savings-desc" },
  { label: "Savings low", value: "savings-asc" },
] as const;

type SortValue = (typeof sortOptions)[number]["value"];

function getReportDownloadPath(leadId: string) {
  return `/api/report/pdf?leadId=${encodeURIComponent(leadId)}&raw=1&download=1`;
}

function getEstimateReportPath(address: string) {
  return `/estimate?address=${encodeURIComponent(address)}`;
}

function getCalendlyUrl(lead: DashboardCrmLead) {
  const baseUrl = process.env.NEXT_PUBLIC_CALENDLY_URL?.trim();

  if (!baseUrl) {
    return "";
  }

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("name", formatName(lead.name));
    url.searchParams.set("email", lead.email);
    url.searchParams.set("a1", formatDisplayAddress(lead.address));
    url.searchParams.set("hide_landing_page_details", "1");
    url.searchParams.set("hide_gdpr_banner", "1");
    url.searchParams.set("primary_color", "22d3ee");
    return url.toString();
  } catch {
    return "";
  }
}

function getDashboardTokenFromLocation() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
}

function getUtilityBillDownloadPath(
  leadId: string,
  dashboardToken: string,
  format?: "json"
) {
  const params = new URLSearchParams({
    leadId,
  });

  if (dashboardToken) {
    params.set("token", dashboardToken);
  }

  if (format) {
    params.set("format", format);
  }

  return `/api/utility-bills/download?${params.toString()}`;
}

export function DashboardCrm({ leads, followUps, stats }: DashboardCrmProps) {
  const [leadItems, setLeadItems] = useState(leads);
  const [followUpItems, setFollowUpItems] = useState(followUps);
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DashboardLeadStatus | "all">("all");
  const [sortBy, setSortBy] = useState<SortValue>("newest");
  const [pdfUnavailableIds, setPdfUnavailableIds] = useState<Set<string>>(
    () => new Set()
  );
  const [utilityBillUnavailableIds, setUtilityBillUnavailableIds] = useState<
    Set<string>
  >(() => new Set());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLeadItems(leads);
      setSelectedLeadId((current) => current || leads[0]?.id || "");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [leads]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setFollowUpItems(followUps));

    return () => window.cancelAnimationFrame(frame);
  }, [followUps]);

  const filteredLeads = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();

    const nextLeads = leadItems
      .filter((lead) => {
        if (statusFilter !== "all" && lead.status !== statusFilter) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [lead.name, lead.email, lead.address]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sortBy === "savings-desc") {
          return b.annualSavings - a.annualSavings;
        }

        if (sortBy === "savings-asc") {
          return a.annualSavings - b.annualSavings;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    return nextLeads;
  }, [deferredSearch, leadItems, sortBy, statusFilter]);

  const selectedLead =
    leadItems.find((lead) => lead.id === selectedLeadId) ??
    filteredLeads[0] ??
    leadItems[0] ??
    null;

  const followUpsForSelected = selectedLead
    ? followUpItems.filter((followUp) => followUp.leadId === selectedLead.id)
    : [];

  const handlePdfDownload = async (lead: DashboardCrmLead) => {
    if (pdfUnavailableIds.has(lead.id)) {
      return;
    }

    try {
      const response = await fetch(getReportDownloadPath(lead.id));
      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok || !contentType.includes("application/pdf")) {
        throw new Error("PDF endpoint did not return a PDF.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildPdfFilename(lead);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      trackEvent("pdf_downloaded", {
        lead_id: lead.id,
      });
    } catch {
      setPdfUnavailableIds((current) => new Set(current).add(lead.id));
    }
  };

  const handleUtilityBillView = async (lead: DashboardCrmLead) => {
    if (!lead.utilityBillUploaded || utilityBillUnavailableIds.has(lead.id)) {
      return;
    }

    try {
      const dashboardToken = getDashboardTokenFromLocation();
      const response = await fetch(
        getUtilityBillDownloadPath(lead.id, dashboardToken, "json"),
        {
          cache: "no-store",
        }
      );
      const payload: { url?: string } = await response.json().catch(() => ({}));

      if (!response.ok || !payload.url) {
        throw new Error("Utility bill is unavailable.");
      }

      window.open(
        getUtilityBillDownloadPath(lead.id, dashboardToken),
        "_blank",
        "noopener,noreferrer"
      );
    } catch {
      setUtilityBillUnavailableIds((current) => new Set(current).add(lead.id));
    }
  };

  const handleSendFollowUpNow = async (followUp: DashboardCrmFollowUp) => {
    const previousFollowUp = followUp;

    setFollowUpItems((current) =>
      current.map((item) =>
        item.id === followUp.id
          ? {
              ...item,
              attempts: item.attempts + 1,
              deliveryMessage: "Sending now...",
              processedAt: new Date().toISOString(),
              status: "sent",
            }
          : item
      )
    );

    try {
      const response = await fetch("/api/follow-ups/send-now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ followUpId: followUp.id }),
      });
      const payload: {
        followUp?: {
          attempts: number;
          deliveryMessage: string | null;
          processedAt: string | null;
          status: DashboardCrmFollowUp["status"];
        };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !payload.followUp) {
        throw new Error("Unable to send follow-up");
      }

      setFollowUpItems((current) =>
        current.map((item) =>
          item.id === followUp.id
            ? {
                ...item,
                attempts: payload.followUp?.attempts ?? item.attempts,
                deliveryMessage: payload.followUp?.deliveryMessage ?? item.deliveryMessage,
                processedAt: payload.followUp?.processedAt ?? item.processedAt,
                status: payload.followUp?.status ?? item.status,
              }
            : item
        )
      );
    } catch {
      setFollowUpItems((current) =>
        current.map((item) => (item.id === followUp.id ? previousFollowUp : item))
      );
    }
  };

  const handleResendSms = async (lead: DashboardCrmLead) => {
    try {
      const response = await fetch("/api/sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: formatDisplayAddress(lead.address),
          annualSavings: lead.annualSavings,
          firstName: formatName(lead.name).split(/\s+/)[0] ?? "there",
          leadId: lead.id,
          phone: lead.phone,
          reportUrl: `${window.location.origin}${getEstimateReportPath(lead.address)}`,
        }),
      });
      const payload: { smsSentAt?: string; success?: boolean } = await response
        .json()
        .catch(() => ({}));

      if (response.ok && payload.smsSentAt) {
        setLeadItems((current) =>
          current.map((item) =>
            item.id === lead.id ? { ...item, smsSentAt: payload.smsSentAt ?? null } : item
          )
        );
      }
    } catch {
      // Manual SMS resend should never break dashboard usage.
    }
  };

  const handleStatusChange = async (
    lead: DashboardCrmLead,
    nextStatus: DashboardLeadStatus
  ) => {
    const previousStatus = lead.status;

    setUpdatingIds((current) => new Set(current).add(lead.id));
    setLeadItems((current) =>
      current.map((item) =>
        item.id === lead.id ? { ...item, status: nextStatus } : item
      )
    );

    try {
      const response = await fetch("/api/leads/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId: lead.id,
          status: nextStatus,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to update status");
      }
    } catch {
      setLeadItems((current) =>
        current.map((item) =>
          item.id === lead.id ? { ...item, status: previousStatus } : item
        )
      );
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const exportCsv = () => {
    const rows = [
      [
        "name",
        "email",
        "phone",
        "address",
        "monthly_bill",
        "annual_savings",
        "lead_score",
        "lead_score_label",
        "roi_years",
        "co2_offset",
        "energy_offset_pct",
        "selected_panel_brand",
        "selected_panel_model",
        "selected_panel_watts",
        "utility_bill_uploaded",
        "sms_sent_at",
        "battery_added",
        "battery_brand",
        "battery_model",
        "battery_cost",
        "referral_code",
        "referred_by",
        "system_cost_before_incentives",
        "federal_tax_credit",
        "net_system_cost",
        "selected_inverter_type",
        "status",
        "created_at",
      ],
      ...leadItems.map((lead) => [
        lead.name,
        lead.email,
        lead.phone,
        formatDisplayAddress(lead.address),
        String(Math.round(lead.monthlyBill || 0)),
        String(Math.round(lead.annualSavings || 0)),
        String(lead.leadScore),
        lead.leadScoreLabel,
        String(lead.estimatedRoiYears || ""),
        String(Math.round(lead.co2OffsetLbs || 0)),
        String(Math.round(lead.energyOffsetPct || 0)),
        lead.selectedPanelBrand ?? "",
        lead.selectedPanelModel ?? "",
        lead.selectedPanelWatts ? String(lead.selectedPanelWatts) : "",
        lead.utilityBillUploaded ? "Yes" : "No",
        lead.smsSentAt ?? "",
        lead.batteryAdded ? "Yes" : "No",
        lead.batteryBrand ?? "",
        lead.batteryModel ?? "",
        lead.batteryCost ? String(Math.round(lead.batteryCost)) : "",
        lead.referralCode ?? "",
        lead.referredBy ?? "",
        lead.systemCostBeforeIncentives
          ? String(Math.round(lead.systemCostBeforeIncentives))
          : "",
        lead.federalTaxCredit ? String(Math.round(lead.federalTaxCredit)) : "",
        lead.netSystemCost ? String(Math.round(lead.netSystemCost)) : "",
        lead.selectedInverterType ?? "",
        getStatusLabel(lead.status),
        lead.createdAt,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "leads.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.28),_transparent_36%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col justify-between gap-4 rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-5 py-4 shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
              Homeowner dashboard
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              Solar lead pipeline
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Manage leads, download reports, and move each homeowner through the pipeline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
            >
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </button>
            <Link
              href="/"
              className="inline-flex items-center rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Back to site
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total Leads" value={formatNumber(stats.totalLeads)} />
          <KpiCard label="Avg Savings" value={formatMoney(stats.averageSavings)} />
          <KpiCard label="Avg Lead Score" value={`${formatNumber(stats.averageLeadScore)}/100`} />
          <KpiCard label="Avg Payback" value={`${formatDecimal(stats.averagePayback)} yrs`} />
          <KpiCard label="Queued Follow-ups" value={formatNumber(stats.queuedFollowUps)} />
          <KpiCard label="PDFs Generated" value={formatNumber(stats.pdfsGenerated)} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,3fr)]">
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <label className="flex min-h-12 flex-1 items-center gap-3 rounded-full border border-white/10 bg-slate-950/55 px-4 text-sm text-slate-300">
                <Search className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) =>
                    startTransition(() => setSearch(event.target.value))
                  }
                  placeholder="Search name, email, or address"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(value) =>
                    setStatusFilter(value as DashboardLeadStatus | "all")
                  }
                  options={[
                    { label: "All stages", value: "all" },
                    ...statusColumns.map((column) => ({
                      label: column.label,
                      value: column.id,
                    })),
                  ]}
                />
                <Select
                  label="Sort"
                  value={sortBy}
                  onChange={(value) => setSortBy(value as SortValue)}
                  options={sortOptions}
                />
              </div>
            </div>
            <p className="mt-3 rounded-[0.95rem] border border-white/8 bg-slate-950/34 px-3 py-2 text-xs leading-5 text-slate-400">
              {LEAD_SCORE_EXPLANATION}
            </p>

            {filteredLeads.length ? (
              <div className="mt-4 grid gap-4">
                <StageSummary leads={filteredLeads} />
                <LeadTable
                  leads={filteredLeads}
                  onDownloadPdf={handlePdfDownload}
                  onSelectLead={setSelectedLeadId}
                  onStatusChange={(lead, nextStatus) =>
                    void handleStatusChange(lead, nextStatus)
                  }
                  pdfUnavailableIds={pdfUnavailableIds}
                  selectedLeadId={selectedLead?.id ?? ""}
                  updatingIds={updatingIds}
                />
              </div>
            ) : (
              <EmptyState
                title="No leads match this view"
                description="Try clearing the search or switching the stage filter."
              />
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            {selectedLead ? (
              <LeadDetailPanel
                followUps={followUpsForSelected}
                lead={selectedLead}
                onDownloadPdf={() => handlePdfDownload(selectedLead)}
                onStatusChange={(nextStatus) =>
                  void handleStatusChange(selectedLead, nextStatus)
                }
                onViewUtilityBill={() => void handleUtilityBillView(selectedLead)}
                onResendSms={() => void handleResendSms(selectedLead)}
                onSendFollowUpNow={(followUp) => void handleSendFollowUpNow(followUp)}
                pdfUnavailable={pdfUnavailableIds.has(selectedLead.id)}
                utilityBillUnavailable={utilityBillUnavailableIds.has(selectedLead.id)}
              />
            ) : (
              <EmptyState
                title="Select a lead"
                description="Lead details, PDF status, and follow-up actions will appear here."
              />
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[1.25rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_14px_45px_rgba(2,8,20,0.24)] backdrop-blur-xl">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
    </article>
  );
}

function StageSummary({ leads }: { leads: DashboardCrmLead[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {statusColumns.map((column) => {
        const count = leads.filter((lead) => lead.status === column.id).length;

        return (
          <div
            key={column.id}
            className="rounded-[1rem] border border-white/8 bg-slate-950/42 px-3 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {column.label}
              </span>
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-semibold text-white">
                {count}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-cyan-300/70"
                style={{
                  width: `${leads.length ? Math.max(8, (count / leads.length) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadTable({
  leads,
  onDownloadPdf,
  onSelectLead,
  onStatusChange,
  pdfUnavailableIds,
  selectedLeadId,
  updatingIds,
}: {
  leads: DashboardCrmLead[];
  onDownloadPdf: (lead: DashboardCrmLead) => void;
  onSelectLead: (leadId: string) => void;
  onStatusChange: (
    lead: DashboardCrmLead,
    status: DashboardLeadStatus
  ) => void;
  pdfUnavailableIds: Set<string>;
  selectedLeadId: string;
  updatingIds: Set<string>;
}) {
  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950/42">
      <div className="hidden grid-cols-[minmax(15rem,1.35fr)_0.7fr_0.65fr_0.6fr_0.8fr_0.85fr] gap-3 border-b border-white/8 px-4 py-3 text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
        <span>Lead</span>
        <span>Savings</span>
        <span>Score</span>
        <span>Payback</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>

      <div className="divide-y divide-white/8">
        {leads.map((lead) => {
          const selected = selectedLeadId === lead.id;
          const pdfUnavailable = pdfUnavailableIds.has(lead.id);

          return (
            <article
              key={lead.id}
              className={`grid gap-3 px-4 py-4 transition lg:grid-cols-[minmax(15rem,1.35fr)_0.7fr_0.65fr_0.6fr_0.8fr_0.85fr] lg:items-center ${
                selected
                  ? "bg-cyan-300/[0.075] ring-1 ring-inset ring-cyan-200/25"
                  : "hover:bg-white/[0.035]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectLead(lead.id)}
                className="min-w-0 text-left"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cyan-200/18 bg-cyan-300/10 text-sm font-bold text-cyan-100">
                    {(formatName(lead.name) || "H").slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {formatName(lead.name) || "Homeowner"}
                    </span>
                    <span className="mt-1 block line-clamp-1 text-xs text-slate-400">
                      {formatDisplayAddress(lead.address)}
                    </span>
                    <span className="mt-1 block truncate text-[0.68rem] font-semibold text-cyan-100/78">
                      Panel: {formatPanelSelection(lead)}
                    </span>
                    {lead.utilityBillUploaded ? (
                      <span className="mt-2 inline-flex rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-emerald-100">
                        Bill verified
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>

              <TableMetric label="Savings" value={formatMoney(lead.annualSavings)} />
              <div className="flex items-center gap-2">
                <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
                <span className="text-sm font-semibold text-white lg:hidden">
                  {lead.leadScore}/100
                </span>
              </div>
              <TableMetric
                label="Payback"
                value={`${formatDecimal(lead.estimatedRoiYears)} yrs`}
              />
              <StatusSelect
                disabled={updatingIds.has(lead.id)}
                value={lead.status}
                onChange={(nextStatus) => onStatusChange(lead, nextStatus)}
              />
              <div className="flex items-center justify-start gap-2 lg:justify-end">
                {pdfUnavailable ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-500">
                    PDF unavailable
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDownloadPdf(lead)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    PDF
                  </button>
                )}
                <a
                  href={getEstimateReportPath(lead.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/78 transition hover:bg-white/[0.1] hover:text-white"
                >
                  Open
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TableMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500 lg:hidden">
        {label}
      </p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function LeadPipelineCard({
  isSelected,
  isUpdating,
  lead,
  onDownloadPdf,
  onSelect,
  onStatusChange,
  pdfUnavailable,
}: {
  isSelected: boolean;
  isUpdating: boolean;
  lead: DashboardCrmLead;
  onDownloadPdf: () => void;
  onSelect: () => void;
  onStatusChange: (status: DashboardLeadStatus) => void;
  pdfUnavailable: boolean;
}) {
  return (
    <article
      className={`rounded-[1rem] border p-3 text-left transition ${
        isSelected
          ? "border-cyan-300/45 bg-cyan-300/10"
          : "border-white/8 bg-white/[0.04] hover:border-white/18 hover:bg-white/[0.06]"
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">
              {formatName(lead.name) || "Homeowner"}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
              {formatDisplayAddress(lead.address)}
            </p>
            <p className="mt-1 truncate text-[0.68rem] font-semibold text-cyan-100/78">
              Panel: {formatPanelSelection(lead)}
            </p>
          </div>
          <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <MiniMetric label="Savings" value={formatMoney(lead.annualSavings)} />
          <MiniMetric label="Lead score" value={`${lead.leadScore}/100`} />
        </div>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/8 pt-3">
        <StatusSelect
          disabled={isUpdating}
          value={lead.status}
          onChange={onStatusChange}
        />
        {pdfUnavailable ? (
          <span className="text-xs font-semibold text-slate-500">PDF unavailable</span>
        ) : (
          <button
            type="button"
            onClick={onDownloadPdf}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            PDF
          </button>
        )}
      </div>
    </article>
  );
}

function LeadDetailPanel({
  followUps,
  lead,
  onDownloadPdf,
  onResendSms,
  onSendFollowUpNow,
  onStatusChange,
  onViewUtilityBill,
  pdfUnavailable,
  utilityBillUnavailable,
}: {
  followUps: DashboardCrmFollowUp[];
  lead: DashboardCrmLead;
  onDownloadPdf: () => void;
  onResendSms: () => void;
  onSendFollowUpNow: (followUp: DashboardCrmFollowUp) => void;
  onStatusChange: (status: DashboardLeadStatus) => void;
  onViewUtilityBill: () => void;
  pdfUnavailable: boolean;
  utilityBillUnavailable: boolean;
}) {
  return (
    <section className="rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
            Lead detail
          </p>
          <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight text-white">
            {formatName(lead.name) || "Homeowner"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {formatDisplayAddress(lead.address)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
          <StatusBadge status={lead.status} />
          {lead.utilityBillUploaded ? <BillVerifiedBadge /> : null}
        </div>
      </div>

      <div className="mt-4 rounded-[1.05rem] border border-white/8 bg-slate-950/38 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Lead score
            </p>
            <p className="mt-1 text-3xl font-semibold text-white">
              {lead.leadScore}/100
            </p>
          </div>
          <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          {lead.leadScoreExplanation}
        </p>
      </div>

      <div className="mt-5 grid gap-2 text-sm">
        <DetailRow label="Email" value={lead.email} />
        <DetailRow label="Phone" value={lead.phone} />
        <DetailRow label="Monthly bill" value={formatMoney(lead.monthlyBill)} />
        <DetailRow
          label="Utility bill"
          value={lead.utilityBillUploaded ? "Uploaded for review" : "Not uploaded"}
        />
        <DetailRow
          label="SMS"
          value={
            lead.smsSentAt
              ? `Sent ${formatDateTime(lead.smsSentAt)}`
              : lead.phone
                ? "Not sent yet"
                : "Not sent: no phone"
          }
        />
        <DetailRow label="Annual savings" value={formatMoney(lead.annualSavings)} />
        <DetailRow label="System size" value={`${formatDecimal(lead.systemSizeKw)} kW`} />
        <DetailRow label="Panel count" value={`${lead.panelCount} panels`} />
        <DetailRow
          label="Selected panel"
          value={
            lead.selectedPanelBrand && lead.selectedPanelModel
              ? `${lead.selectedPanelBrand} ${lead.selectedPanelModel}${
                  lead.selectedPanelWatts ? ` ${lead.selectedPanelWatts}W` : ""
                }`
              : "Not captured"
          }
        />
        <DetailRow
          label="Inverter"
          value={formatInverterLabel(lead.selectedInverterType)}
        />
        <DetailRow
          label="Battery"
          value={
            lead.batteryAdded && lead.batteryBrand && lead.batteryModel
              ? `${lead.batteryBrand} ${lead.batteryModel}${
                  lead.batteryCost ? ` - ${formatMoney(lead.batteryCost)}` : ""
                }`
              : "None"
          }
        />
        <DetailRow
          label="Referral code"
          value={lead.referralCode ?? "Not captured"}
        />
        <DetailRow
          label="Referred by"
          value={lead.referredBy ?? "Direct"}
        />
        <DetailRow
          label="Referrals made"
          value={`${lead.referralsMade}`}
        />
        <DetailRow
          label="Gross system cost"
          value={
            lead.systemCostBeforeIncentives
              ? formatMoney(lead.systemCostBeforeIncentives)
              : "Not captured"
          }
        />
        <DetailRow
          label="Federal credit"
          value={
            lead.federalTaxCredit ? formatMoney(lead.federalTaxCredit) : "Not captured"
          }
        />
        <DetailRow
          label="Net system cost"
          value={lead.netSystemCost ? formatMoney(lead.netSystemCost) : "Not captured"}
        />
        <DetailRow label="Estimated ROI" value={`${formatDecimal(lead.estimatedRoiYears)} yrs`} />
        <DetailRow label="Energy offset" value={`${formatNumber(lead.energyOffsetPct)}%`} />
        <DetailRow label="CO2 offset" value={`${formatNumber(lead.co2OffsetLbs)} lbs`} />
      </div>

      <div className="mt-5 grid gap-2">
        <StatusSelect value={lead.status} onChange={onStatusChange} />
        {pdfUnavailable ? (
          <div className="rounded-full border border-white/10 bg-slate-950/42 px-4 py-3 text-center text-sm font-semibold text-slate-500">
            PDF unavailable
          </div>
        ) : (
          <button
            type="button"
            onClick={onDownloadPdf}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PDF
          </button>
        )}
        {lead.utilityBillUploaded ? (
          utilityBillUnavailable ? (
            <div className="rounded-full border border-white/10 bg-slate-950/42 px-4 py-3 text-center text-sm font-semibold text-slate-500">
              Utility bill unavailable
            </div>
          ) : (
            <button
              type="button"
              onClick={onViewUtilityBill}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/18"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              View Utility Bill
            </button>
          )
        ) : null}
        <button
          type="button"
          onClick={onResendSms}
          disabled={!lead.phone}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Resend SMS
        </button>
        <a
          href={getEstimateReportPath(lead.address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.09]"
        >
          Open Report
        </a>
      </div>

      <div className="mt-6 rounded-[1.2rem] border border-white/8 bg-slate-950/38 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            Lead nurture
          </p>
          <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </div>
        <a
          href={getCalendlyUrl(lead)}
          target="_blank"
          rel="noreferrer"
          className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition ${
            getCalendlyUrl(lead)
              ? "border border-cyan-300/20 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/18"
              : "pointer-events-none border border-white/10 bg-white/[0.035] text-slate-500"
          }`}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {getCalendlyUrl(lead) ? "Book a call" : "Calendly not connected"}
        </a>
        {followUps.length ? (
          <div className="mt-3 grid gap-2">
            {followUps.slice(0, 4).map((followUp) => (
              <div
                key={followUp.id}
                className="rounded-[0.9rem] border border-white/8 bg-white/[0.035] px-3 py-2 text-xs text-slate-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{followUp.title}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.14em] text-slate-400">
                      {followUp.status}
                    </span>
                    {followUp.status === "queued" || followUp.status === "scheduled" ? (
                      <button
                        type="button"
                        onClick={() => onSendFollowUpNow(followUp)}
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-300/18"
                      >
                        <Send className="h-3 w-3" aria-hidden="true" />
                        Send now
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-slate-500">{followUp.message}</p>
                {followUp.deliveryMessage ? (
                  <p className="mt-1 text-[0.65rem] text-slate-500">
                    {followUp.deliveryMessage}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            title="No follow-ups scheduled yet."
            description="Create your first follow-up workflow."
          />
        )}
      </div>
    </section>
  );
}

function EmptyState({
  compact = false,
  description,
  title,
}: {
  compact?: boolean;
  description: string;
  title: string;
}) {
  return (
    <div
      className={`rounded-[1.2rem] border border-dashed border-white/12 bg-white/[0.035] text-center ${
        compact ? "mt-3 px-3 py-5" : "p-8"
      }`}
    >
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-cyan-300/10 text-cyan-200">
        <Search className="h-4 w-4" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function StageEmptyState() {
  return (
    <div className="rounded-[1rem] border border-dashed border-white/14 bg-white/[0.025] px-3 py-6 text-center">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-500">
        <UserRound className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs font-semibold text-slate-400">No leads in this stage.</p>
      <p className="mt-1 text-[0.68rem] leading-4 text-slate-600">
        Drag a lead here or use the dropdown.
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.8rem] border border-white/8 bg-slate-950/34 px-2.5 py-2">
      <p className="text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/8 py-2 last:border-b-0 sm:grid-cols-[0.78fr_1.22fr] sm:items-start">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-left font-semibold text-white sm:text-right">
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: DashboardLeadStatus }) {
  const color =
    status === "closed-won"
      ? "bg-emerald-300/16 text-emerald-100"
      : status === "closed-lost"
        ? "bg-rose-300/14 text-rose-100"
        : status === "quoted"
          ? "bg-amber-300/16 text-amber-100"
          : status === "contacted"
            ? "bg-sky-300/16 text-sky-100"
            : "bg-white/[0.08] text-slate-200";

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${color}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function LeadScoreBadge({
  label,
  score,
}: {
  label: LeadScoreLabel;
  score: number;
}) {
  const color =
    label === "Hot Lead"
      ? "border-rose-300/25 bg-rose-300/16 text-rose-50"
      : label === "Warm Lead"
        ? "border-amber-300/25 bg-amber-300/16 text-amber-50"
        : "border-slate-300/18 bg-white/[0.08] text-slate-200";

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${color}`}
      title={`${score}/100`}
    >
      {label}
    </span>
  );
}

function BillVerifiedBadge() {
  return (
    <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] text-emerald-100">
      Bill verified
    </span>
  );
}

function StatusSelect({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (status: DashboardLeadStatus) => void;
  value: DashboardLeadStatus;
}) {
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as DashboardLeadStatus)}
      className="min-h-9 rounded-full border border-white/10 bg-slate-950/72 px-3 text-xs font-semibold text-white outline-none transition hover:border-cyan-300/35 disabled:opacity-60"
    >
      {statusColumns.map((column) => (
        <option key={column.id} value={column.id}>
          {column.label}
        </option>
      ))}
    </select>
  );
}

function Select({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/10 bg-slate-950/55 px-3 text-xs font-semibold text-slate-300">
      <span className="text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function getStatusLabel(status: DashboardLeadStatus) {
  return statusColumns.find((column) => column.id === status)?.label ?? "New";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatInverterLabel(value: string | null) {
  if (value === "microinverters") {
    return "Microinverters";
  }

  if (value === "optimizers") {
    return "Power optimizers";
  }

  if (value === "string") {
    return "String inverter";
  }

  return "Not captured";
}

function formatPanelSelection(lead: DashboardCrmLead) {
  if (lead.selectedPanelBrand && lead.selectedPanelWatts) {
    return `${lead.selectedPanelBrand} ${lead.selectedPanelWatts}W`;
  }

  if (lead.selectedPanelBrand && lead.selectedPanelModel) {
    return `${lead.selectedPanelBrand} ${lead.selectedPanelModel}`;
  }

  return "Not captured";
}

function buildPdfFilename(lead: DashboardCrmLead) {
  const safeName =
    formatName(lead.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "homeowner";
  const date = new Date().toISOString().slice(0, 10);

  return `solar-report-${safeName}-${date}.pdf`;
}

function escapeCsvCell(value: string) {
  const needsEscaping = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsEscaping ? `"${escaped}"` : escaped;
}
