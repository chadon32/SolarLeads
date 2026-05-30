"use client";

import type { MouseEvent, ReactNode } from "react";
import {
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import {
  CalendarClock,
  Download,
  Eye,
  FileDown,
  Mail,
  MapPin,
  Phone,
  Save,
  Search,
  X,
} from "lucide-react";
import { formatDisplayAddress } from "@/lib/address-format";
import { trackEvent } from "@/lib/analytics";
import type { LeadScoreLabel } from "@/lib/lead-scoring";

export type InstallerLeadStatus =
  | "new"
  | "contacted"
  | "quoted"
  | "closed-won"
  | "closed-lost";

export type InstallerFollowUpStatus =
  | "Not started"
  | "Report sent"
  | "First follow-up due"
  | "Contacted"
  | "Quote requested"
  | "Closed"
  | "Lost";

export type InstallerFollowUpStep = {
  channel: string;
  deliveryMessage: string | null;
  processedAt: string | null;
  scheduledFor: string;
  status: string;
  stepOrder: number;
  title: string;
};

type FollowUpAction =
  | "report-sent"
  | "contacted"
  | "first-follow-up-due"
  | "quote-requested"
  | "closed"
  | "lost";

export type InstallerLead = {
  address: string;
  annualSavings: number;
  city: string;
  createdAt: string;
  email: string;
  energyOffsetPct: number;
  followUpStatus: string;
  followUpNotes: string;
  followUpSteps: InstallerFollowUpStep[];
  id: string;
  lastContactedAt: string | null;
  leadScore: number;
  leadScoreLabel: LeadScoreLabel;
  monthlyBill: number;
  name: string;
  notes: string;
  nextFollowUpAt: string | null;
  panelCount: number;
  pdfDownloaded: boolean;
  pdfGenerated: boolean;
  phone: string;
  reportUrl: string;
  roiYears: number;
  solarScore: number;
  status: InstallerLeadStatus;
  systemSizeKw: number;
  utilityBillUploaded: boolean;
};

type InstallerDashboardProps = {
  automationConnected: boolean;
  leads: InstallerLead[];
  stats: {
    averageSavings: number;
    averageSolarScore: number;
    hotLeads: number;
    pdfsDownloaded: number;
    reportsGenerated: number;
    totalLeads: number;
  };
};

const statusOptions: Array<{ label: string; value: InstallerLeadStatus }> = [
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Quote Requested", value: "quoted" },
  { label: "Closed Won", value: "closed-won" },
  { label: "Closed Lost", value: "closed-lost" },
];

const leadScoreFilters = [
  { label: "All scores", value: "all" },
  { label: "Hot", value: "hot" },
  { label: "Warm", value: "warm" },
  { label: "Cold", value: "cold" },
] as const;

const savingsFilters = [
  { label: "Any savings", value: "all" },
  { label: "$0-$1.5K", value: "0-1500" },
  { label: "$1.5K-$3K", value: "1500-3000" },
  { label: "$3K+", value: "3000+" },
] as const;

const solarScoreFilters = [
  { label: "Any solar score", value: "all" },
  { label: "80-100", value: "80-100" },
  { label: "55-79", value: "55-79" },
  { label: "0-54", value: "0-54" },
] as const;

const dateFilters = [
  { label: "Any date", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

function getReportViewerPath(leadId: string) {
  return `/report/${encodeURIComponent(leadId)}`;
}

export function InstallerDashboard({
  automationConnected,
  leads,
  stats,
}: InstallerDashboardProps) {
  const [leadItems, setLeadItems] = useState(leads);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    leads[0]?.id ?? null
  );
  const [search, setSearch] = useState("");
  const [leadScoreFilter, setLeadScoreFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [savingsFilter, setSavingsFilter] = useState("all");
  const [solarScoreFilter, setSolarScoreFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [pdfUnavailableIds, setPdfUnavailableIds] = useState<Set<string>>(
    () => new Set()
  );
  const [savingNotesIds, setSavingNotesIds] = useState<Set<string>>(
    () => new Set()
  );
  const [savingFollowUpIds, setSavingFollowUpIds] = useState<Set<string>>(
    () => new Set()
  );
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [followUpNoteDrafts, setFollowUpNoteDrafts] = useState<Record<string, string>>({});
  const [followUpDateDrafts, setFollowUpDateDrafts] = useState<Record<string, string>>({});
  const deferredSearch = useDeferredValue(search);

  const cities = useMemo(
    () =>
      Array.from(new Set(leadItems.map((lead) => lead.city).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b)),
    [leadItems]
  );

  const filteredLeads = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return leadItems.filter((lead) => {
      if (
        query &&
        ![lead.name, lead.email, lead.phone, lead.address, lead.city]
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }

      if (leadScoreFilter !== "all" && getLeadScoreTier(lead) !== leadScoreFilter) {
        return false;
      }

      if (cityFilter !== "all" && lead.city !== cityFilter) {
        return false;
      }

      if (!matchesSavingsRange(lead.annualSavings, savingsFilter)) {
        return false;
      }

      if (!matchesSolarScoreRange(lead.solarScore, solarScoreFilter)) {
        return false;
      }

      if (statusFilter !== "all" && lead.status !== statusFilter) {
        return false;
      }

      if (!matchesDateRange(lead.createdAt, dateFilter)) {
        return false;
      }

      return true;
    });
  }, [
    cityFilter,
    dateFilter,
    deferredSearch,
    leadItems,
    leadScoreFilter,
    savingsFilter,
    solarScoreFilter,
    statusFilter,
  ]);

  const selectedLead =
    leadItems.find((lead) => lead.id === selectedLeadId) ??
    filteredLeads[0] ??
    null;

  const handlePdfDownload = (lead: InstallerLead) => {
    if (pdfUnavailableIds.has(lead.id)) {
      return;
    }

    setLeadItems((current) =>
      current.map((item) =>
        item.id === lead.id ? { ...item, pdfDownloaded: true } : item
      )
    );
    trackEvent("pdf_downloaded", {
      lead_id: lead.id,
      surface: "installer_dashboard",
    });
  };

  const updateStatus = async (
    lead: InstallerLead,
    status: InstallerLeadStatus
  ) => {
    const previous = lead.status;
    setLeadItems((current) =>
      current.map((item) => (item.id === lead.id ? { ...item, status } : item))
    );

    try {
      const response = await fetch("/api/leads/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, status }),
      });

      if (!response.ok) {
        throw new Error("Status update failed");
      }
    } catch {
      setLeadItems((current) =>
        current.map((item) =>
          item.id === lead.id ? { ...item, status: previous } : item
        )
      );
    }
  };

  const saveNotes = async (lead: InstallerLead) => {
    const notes = noteDrafts[lead.id] ?? lead.notes;

    setSavingNotesIds((current) => new Set(current).add(lead.id));

    try {
      const response = await fetch("/api/leads/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, notes }),
      });

      if (!response.ok) {
        throw new Error("Note save failed");
      }

      setLeadItems((current) =>
        current.map((item) => (item.id === lead.id ? { ...item, notes } : item))
      );
    } finally {
      setSavingNotesIds((current) => {
        const next = new Set(current);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const updateFollowUp = async (
    lead: InstallerLead,
    action: FollowUpAction,
    options: { nextFollowUpAt?: string | null } = {}
  ) => {
    const previousLead = lead;
    const followUpNotes = followUpNoteDrafts[lead.id] ?? lead.followUpNotes;
    let scheduledSteps: InstallerFollowUpStep[] | undefined;

    setSavingFollowUpIds((current) => new Set(current).add(lead.id));

    if (action === "first-follow-up-due") {
      const sequenceResponse = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      }).catch(() => null);

      if (sequenceResponse?.ok) {
        const sequencePayload = (await sequenceResponse.json().catch(() => ({}))) as {
          steps?: InstallerFollowUpStep[];
        };
        scheduledSteps = sequencePayload.steps;
      }
    }

    try {
      const response = await fetch("/api/leads/follow-up", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          followUpNotes,
          leadId: lead.id,
          nextFollowUpAt: options.nextFollowUpAt,
        }),
      });

      if (!response.ok) {
        throw new Error("Follow-up update failed");
      }

      const payload = (await response.json().catch(() => ({}))) as {
        lead?: {
          followUpNotes?: string;
          followUpStatus?: InstallerFollowUpStatus;
          lastContactedAt?: string | null;
          nextFollowUpAt?: string | null;
          status?: string | null;
        };
      };
      const nextStatus = normalizeInstallerStatus(payload.lead?.status);

      setLeadItems((current) =>
        current.map((item) =>
          item.id === lead.id
            ? {
                ...item,
                followUpNotes: payload.lead?.followUpNotes ?? followUpNotes,
                followUpSteps:
                  scheduledSteps ??
                  getUpdatedFollowUpSteps(
                    item.followUpSteps,
                    action,
                    payload.lead?.nextFollowUpAt ?? options.nextFollowUpAt
                  ),
                followUpStatus:
                  payload.lead?.followUpStatus ?? getFollowUpActionLabel(action),
                lastContactedAt:
                  payload.lead?.lastContactedAt ?? getStampedContactDate(action, item),
                nextFollowUpAt:
                  payload.lead?.nextFollowUpAt ??
                  options.nextFollowUpAt ??
                  getDefaultNextFollowUp(action),
                status: nextStatus ?? item.status,
              }
            : item
        )
      );
    } catch {
      setLeadItems((current) =>
        current.map((item) => (item.id === lead.id ? previousLead : item))
      );
    } finally {
      setSavingFollowUpIds((current) => {
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
        "address",
        "city",
        "phone",
        "email",
        "lead_score",
        "lead_score_label",
        "utility_bill_uploaded",
        "solar_score",
        "annual_savings",
        "system_size_kw",
        "status",
        "follow_up_status",
        "last_contacted_at",
        "next_follow_up_at",
        "follow_up_notes",
        "created_at",
      ],
      ...filteredLeads.map((lead) => [
        lead.name,
        formatDisplayAddress(lead.address),
        lead.city,
        lead.phone,
        lead.email,
        String(lead.leadScore),
        lead.leadScoreLabel,
        lead.utilityBillUploaded ? "Yes" : "No",
        String(lead.solarScore),
        String(Math.round(lead.annualSavings)),
        String(lead.systemSizeKw),
        getStatusLabel(lead.status),
        lead.followUpStatus,
        lead.lastContactedAt ?? "",
        lead.nextFollowUpAt ?? "",
        lead.followUpNotes,
        lead.createdAt,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "installer-leads.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(25,72,108,0.24),_transparent_34%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[92rem] space-y-4">
        <header className="flex flex-col justify-between gap-3 rounded-[1.4rem] border border-white/10 bg-white/[0.045] px-4 py-4 shadow-[0_18px_70px_rgba(2,8,20,0.28)] backdrop-blur-xl lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
              Installer dashboard
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Solar lead command center
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Prioritize high-intent homeowners, download reports, and move leads through the installer pipeline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold ${
                automationConnected
                  ? "border-emerald-300/18 bg-emerald-300/10 text-emerald-100"
                  : "border-amber-300/18 bg-amber-300/10 text-amber-100"
              }`}
            >
              {automationConnected
                ? "Automation connected"
                : "Automation not connected yet"}
            </span>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </button>
            <a
              href="/dashboard"
              className="inline-flex items-center rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Homeowner view
            </a>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <KpiCard label="Total leads" value={formatNumber(stats.totalLeads)} />
          <KpiCard label="Hot leads" value={formatNumber(stats.hotLeads)} tone="hot" />
          <KpiCard label="Avg savings" value={formatMoney(stats.averageSavings)} />
          <KpiCard label="Avg solar score" value={`${stats.averageSolarScore}/100`} />
          <KpiCard label="Reports generated" value={formatNumber(stats.reportsGenerated)} />
          <KpiCard label="PDFs downloaded" value={formatNumber(stats.pdfsDownloaded)} />
        </section>

        <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-3 shadow-[0_18px_70px_rgba(2,8,20,0.28)] backdrop-blur-xl">
          <div className="grid gap-2 xl:grid-cols-[minmax(16rem,1.4fr)_repeat(6,minmax(8rem,1fr))]">
            <label className="flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-slate-950/55 px-3 text-sm text-slate-300">
              <Search className="h-4 w-4 text-cyan-200" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) =>
                  startTransition(() => setSearch(event.target.value))
                }
                placeholder="Search leads"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500"
              />
            </label>
            <FilterSelect
              label="Lead score"
              onChange={setLeadScoreFilter}
              options={leadScoreFilters}
              value={leadScoreFilter}
            />
            <FilterSelect
              label="City"
              onChange={setCityFilter}
              options={[
                { label: "All cities", value: "all" },
                ...cities.map((city) => ({ label: city, value: city })),
              ]}
              value={cityFilter}
            />
            <FilterSelect
              label="Savings"
              onChange={setSavingsFilter}
              options={savingsFilters}
              value={savingsFilter}
            />
            <FilterSelect
              label="Solar score"
              onChange={setSolarScoreFilter}
              options={solarScoreFilters}
              value={solarScoreFilter}
            />
            <FilterSelect
              label="Status"
              onChange={setStatusFilter}
              options={[
                { label: "All status", value: "all" },
                ...statusOptions.map((status) => ({
                  label: status.label,
                  value: status.value,
                })),
              ]}
              value={statusFilter}
            />
            <FilterSelect
              label="Date"
              onChange={setDateFilter}
              options={dateFilters}
              value={dateFilter}
            />
          </div>

          <div className="mt-3 overflow-x-auto rounded-[1.05rem] border border-white/8">
            <table className="min-w-[98rem] w-full border-collapse text-left text-sm">
              <thead className="bg-slate-950/72 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  {[
                    "Name",
                    "Address",
                    "City",
                    "Phone",
                    "Email",
                    "Lead score",
                    "Solar score",
                    "Annual savings",
                    "System size",
                    "Status",
                    "Follow-up",
                    "Next follow-up",
                    "Date created",
                    "Actions",
                  ].map((header) => (
                    <th key={header} className="px-3 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className="cursor-pointer bg-white/[0.025] transition hover:bg-cyan-300/8"
                  >
                    <td className="px-3 py-3 font-semibold text-white">{lead.name}</td>
                    <td className="max-w-[18rem] truncate px-3 py-3 text-slate-300">
                      {formatDisplayAddress(lead.address)}
                    </td>
                    <td className="px-3 py-3 text-slate-300">{lead.city}</td>
                    <td className="px-3 py-3 text-slate-300">{lead.phone}</td>
                    <td className="max-w-[14rem] truncate px-3 py-3 text-slate-300">
                      {lead.email}
                    </td>
                    <td className="px-3 py-3">
                      <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
                      {lead.utilityBillUploaded ? (
                        <div className="mt-1">
                          <BillVerifiedBadge />
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-semibold text-white">
                      {lead.solarScore}/100
                    </td>
                    <td className="px-3 py-3 font-semibold text-white">
                      {formatMoney(lead.annualSavings)}
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      {formatDecimal(lead.systemSizeKw)} kW
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-3">
                      <FollowUpStatusBadge status={lead.followUpStatus} />
                    </td>
                    <td className="px-3 py-3 text-slate-400">
                      {formatOptionalDate(lead.nextFollowUpAt)}
                    </td>
                    <td className="px-3 py-3 text-slate-400">
                      {formatDate(lead.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <IconButton
                          label="View lead"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedLeadId(lead.id);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconButton>
                        {pdfUnavailableIds.has(lead.id) ? (
                          <span className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-full border border-white/10 bg-white/[0.03] text-slate-600" title="PDF unavailable">
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">PDF unavailable</span>
                          </span>
                        ) : (
                          <a
                            href={getReportViewerPath(lead.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              handlePdfDownload(lead);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition hover:bg-white/[0.1] hover:text-white"
                            title="Download PDF"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">Download PDF</span>
                          </a>
                        )}
                        <CompactStatusButton
                          label="Contacted"
                          onClick={(event) => {
                            event.stopPropagation();
                            void updateStatus(lead, "contacted");
                          }}
                        />
                        <CompactStatusButton
                          label="Quote"
                          onClick={(event) => {
                            event.stopPropagation();
                            void updateStatus(lead, "quoted");
                          }}
                        />
                        <CompactStatusButton
                          label="Closed"
                          onClick={(event) => {
                            event.stopPropagation();
                            void updateStatus(lead, "closed-won");
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredLeads.length ? (
              <div className="grid min-h-52 place-items-center bg-slate-950/38 px-6 py-12 text-center">
                <div>
                  <p className="text-lg font-semibold text-white">No leads match this view.</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Try widening the filters or clearing the search.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {selectedLead ? (
        <LeadDrawer
          automationConnected={automationConnected}
          followUpDateDraft={
            followUpDateDrafts[selectedLead.id] ??
            formatDateTimeInputValue(selectedLead.nextFollowUpAt)
          }
          followUpNoteDraft={
            followUpNoteDrafts[selectedLead.id] ?? selectedLead.followUpNotes
          }
          lead={selectedLead}
          noteDraft={noteDrafts[selectedLead.id] ?? selectedLead.notes}
          onClose={() => setSelectedLeadId(null)}
          onDownloadPdf={() => handlePdfDownload(selectedLead)}
          onFollowUpAction={(action) =>
            void updateFollowUp(selectedLead, action, {
              nextFollowUpAt:
                action === "first-follow-up-due"
                  ? followUpDateDrafts[selectedLead.id]
                  : undefined,
            })
          }
          onFollowUpDateChange={(value) =>
            setFollowUpDateDrafts((current) => ({
              ...current,
              [selectedLead.id]: value,
            }))
          }
          onFollowUpNoteChange={(notes) =>
            setFollowUpNoteDrafts((current) => ({
              ...current,
              [selectedLead.id]: notes,
            }))
          }
          onNoteChange={(notes) =>
            setNoteDrafts((current) => ({ ...current, [selectedLead.id]: notes }))
          }
          onSaveNotes={() => void saveNotes(selectedLead)}
          onStatusChange={(status) => void updateStatus(selectedLead, status)}
          pdfUnavailable={pdfUnavailableIds.has(selectedLead.id)}
          savingFollowUp={savingFollowUpIds.has(selectedLead.id)}
          savingNotes={savingNotesIds.has(selectedLead.id)}
        />
      ) : null}
    </main>
  );
}

function LeadDrawer({
  automationConnected,
  followUpDateDraft,
  followUpNoteDraft,
  lead,
  noteDraft,
  onClose,
  onDownloadPdf,
  onFollowUpAction,
  onFollowUpDateChange,
  onFollowUpNoteChange,
  onNoteChange,
  onSaveNotes,
  onStatusChange,
  pdfUnavailable,
  savingFollowUp,
  savingNotes,
}: {
  automationConnected: boolean;
  followUpDateDraft: string;
  followUpNoteDraft: string;
  lead: InstallerLead;
  noteDraft: string;
  onClose: () => void;
  onDownloadPdf: () => void;
  onFollowUpAction: (action: FollowUpAction) => void;
  onFollowUpDateChange: (value: string) => void;
  onFollowUpNoteChange: (notes: string) => void;
  onNoteChange: (notes: string) => void;
  onSaveNotes: () => void;
  onStatusChange: (status: InstallerLeadStatus) => void;
  pdfUnavailable: boolean;
  savingFollowUp: boolean;
  savingNotes: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/42 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-[30rem] flex-col border-l border-white/10 bg-[#08111d]/96 shadow-[-24px_0_80px_rgba(0,0,0,0.38)]">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                Lead detail
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                {lead.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition hover:bg-white/[0.1] hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <LeadScoreBadge label={lead.leadScoreLabel} score={lead.leadScore} />
            {lead.utilityBillUploaded ? <BillVerifiedBadge /> : null}
            <StatusBadge status={lead.status} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <section className="grid gap-3 rounded-[1.15rem] border border-white/10 bg-white/[0.04] p-4">
            <InfoLine icon={<Phone className="h-4 w-4" />} label="Phone" value={lead.phone} />
            <InfoLine icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email} />
            <InfoLine
              icon={<MapPin className="h-4 w-4" />}
              label="Address"
              value={formatDisplayAddress(lead.address)}
            />
          </section>

          <section className="mt-4 grid grid-cols-2 gap-3">
            <DrawerMetric label="Roof score" value={`${lead.solarScore}/100`} />
            <DrawerMetric
              label="Utility bill"
              value={lead.utilityBillUploaded ? "Bill verified" : "Not uploaded"}
            />
            <DrawerMetric label="Panels" value={formatNumber(lead.panelCount)} />
            <DrawerMetric label="Savings" value={formatMoney(lead.annualSavings)} />
            <DrawerMetric label="System" value={`${formatDecimal(lead.systemSizeKw)} kW`} />
            <DrawerMetric label="Energy offset" value={`${formatNumber(lead.energyOffsetPct)}%`} />
            <DrawerMetric label="ROI" value={`${formatDecimal(lead.roiYears)} yrs`} />
          </section>

          <section className="mt-4 rounded-[1.15rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Report
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  PDF {lead.pdfDownloaded ? "downloaded" : "ready"} - Follow-up {lead.followUpStatus}
                </p>
              </div>
              {pdfUnavailable ? (
                <span className="text-xs font-semibold text-slate-500">PDF unavailable</span>
              ) : (
                <a
                  href={getReportViewerPath(lead.id)}
                  onClick={onDownloadPdf}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  PDF
                </a>
              )}
            </div>
          </section>

          <section className="mt-4 rounded-[1.15rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Follow-up tracking
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <FollowUpStatusBadge status={lead.followUpStatus} />
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${
                      automationConnected
                        ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-100"
                        : "border-amber-300/20 bg-amber-300/12 text-amber-100"
                    }`}
                  >
                    {automationConnected
                      ? "Automation connected"
                      : "Automation not connected yet"}
                  </span>
                </div>
              </div>
              <CalendarClock className="h-5 w-5 text-cyan-200" aria-hidden="true" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <DrawerMetric
                label="Last contacted"
                value={formatOptionalDate(lead.lastContactedAt)}
              />
              <DrawerMetric
                label="Next follow-up"
                value={formatOptionalDate(lead.nextFollowUpAt)}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <FollowUpActionButton
                disabled={savingFollowUp}
                label="Mark report sent"
                onClick={() => onFollowUpAction("report-sent")}
              />
              <FollowUpActionButton
                disabled={savingFollowUp}
                label="Mark contacted"
                onClick={() => onFollowUpAction("contacted")}
              />
              <FollowUpActionButton
                disabled={savingFollowUp}
                label="Mark quote requested"
                onClick={() => onFollowUpAction("quote-requested")}
              />
              <FollowUpActionButton
                disabled={savingFollowUp}
                label="Mark closed"
                onClick={() => onFollowUpAction("closed")}
              />
              <FollowUpActionButton
                disabled={savingFollowUp}
                label="Mark lost"
                onClick={() => onFollowUpAction("lost")}
              />
            </div>

            <div className="mt-4 rounded-[1rem] border border-white/10 bg-slate-950/35 p-3">
              <label className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Schedule follow-up
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="datetime-local"
                  value={followUpDateDraft}
                  onChange={(event) => onFollowUpDateChange(event.target.value)}
                  className="min-w-0 rounded-full border border-white/10 bg-slate-950/45 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-cyan-300/35"
                />
                <button
                  type="button"
                  disabled={savingFollowUp}
                  onClick={() => onFollowUpAction("first-follow-up-due")}
                  className="rounded-full bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingFollowUp ? "Saving" : "Schedule"}
                </button>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Follow-up notes
              </span>
              <textarea
                value={followUpNoteDraft}
                onChange={(event) => onFollowUpNoteChange(event.target.value)}
                placeholder="Add follow-up context, timing preference, objections, or call result..."
                className="mt-2 min-h-24 w-full resize-y rounded-[1rem] border border-white/10 bg-slate-950/48 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35"
              />
            </label>

            <div className="mt-4 rounded-[1rem] border border-cyan-300/12 bg-cyan-300/[0.055] p-3">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Recommended sequence
              </p>
              <div className="mt-3 grid gap-2">
                {getRecommendedSequence(lead).map((step) => (
                  <div
                    key={step.stepOrder}
                    className="flex items-center justify-between gap-3 rounded-[0.85rem] border border-white/8 bg-slate-950/30 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-semibold text-white">
                        {step.stepOrder}. {step.title}
                      </p>
                      <p className="mt-0.5 text-[0.68rem] text-slate-500">
                        {step.timing}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[0.56rem] font-bold uppercase tracking-[0.12em] text-slate-300">
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-[1.15rem] border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Status controls
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {statusOptions.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  onClick={() => onStatusChange(status.value)}
                  className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    lead.status === status.value
                      ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-100"
                      : "border-white/10 bg-slate-950/38 text-slate-300 hover:bg-white/[0.06]"
                  }`}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-[1.15rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Notes
              </p>
              <button
                type="button"
                onClick={onSaveNotes}
                disabled={savingNotes}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/[0.1] disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {savingNotes ? "Saving" : "Save"}
              </button>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Add installer notes, call outcome, objections, or next steps..."
              className="mt-3 min-h-36 w-full resize-y rounded-[1rem] border border-white/10 bg-slate-950/48 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35"
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

function KpiCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "hot";
  value: string;
}) {
  return (
    <article className="rounded-[1.1rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_14px_45px_rgba(2,8,20,0.2)] backdrop-blur-xl">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone === "hot" ? "text-rose-100" : "text-white"}`}>
        {value}
      </p>
    </article>
  );
}

function FilterSelect({
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
    <label className="grid gap-1 rounded-[0.95rem] border border-white/10 bg-slate-950/55 px-3 py-2">
      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs font-semibold text-white outline-none"
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

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      title={label}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function CompactStatusButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1.5 text-[0.62rem] font-semibold text-slate-300 transition hover:bg-cyan-300/12 hover:text-cyan-100"
    >
      {label}
    </button>
  );
}

function FollowUpActionButton({
  disabled,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-white/10 bg-slate-950/38 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-55"
    >
      {label}
    </button>
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
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${color}`}
      title={`${score}/100`}
    >
      {score} - {label}
    </span>
  );
}

function BillVerifiedBadge() {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] text-emerald-100">
      Bill verified
    </span>
  );
}

function StatusBadge({ status }: { status: InstallerLeadStatus }) {
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
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${color}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function FollowUpStatusBadge({ status }: { status: string }) {
  const normalized = normalizeFollowUpStatus(status);
  const color =
    normalized === "Closed"
      ? "border-emerald-300/22 bg-emerald-300/14 text-emerald-100"
      : normalized === "Lost"
        ? "border-rose-300/22 bg-rose-300/14 text-rose-100"
        : normalized === "Quote requested"
          ? "border-amber-300/24 bg-amber-300/14 text-amber-100"
          : normalized === "Contacted"
            ? "border-sky-300/22 bg-sky-300/14 text-sky-100"
            : normalized === "First follow-up due"
              ? "border-cyan-300/22 bg-cyan-300/12 text-cyan-100"
              : normalized === "Report sent"
                ? "border-violet-300/22 bg-violet-300/12 text-violet-100"
                : "border-white/10 bg-white/[0.07] text-slate-200";

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.14em] ${color}`}>
      {normalized}
    </span>
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
    <div className="flex gap-3 text-sm">
      <span className="mt-0.5 text-cyan-200">{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
        <p className="mt-1 break-words font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.95rem] border border-white/10 bg-slate-950/38 p-3">
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function matchesSavingsRange(value: number, range: string) {
  if (range === "0-1500") return value < 1500;
  if (range === "1500-3000") return value >= 1500 && value < 3000;
  if (range === "3000+") return value >= 3000;
  return true;
}

function matchesSolarScoreRange(value: number, range: string) {
  if (range === "80-100") return value >= 80;
  if (range === "55-79") return value >= 55 && value < 80;
  if (range === "0-54") return value < 55;
  return true;
}

function matchesDateRange(value: string, range: string) {
  if (range === "all") return true;

  const created = new Date(value).getTime();
  if (!Number.isFinite(created)) return true;

  const now = Date.now();
  if (range === "today") {
    return new Date(value).toDateString() === new Date().toDateString();
  }

  const days = range === "7d" ? 7 : 30;
  return now - created <= days * 24 * 60 * 60 * 1000;
}

function getLeadScoreTier(lead: InstallerLead) {
  if (lead.leadScore >= 80) return "hot";
  if (lead.leadScore >= 55) return "warm";
  return "cold";
}

function getStatusLabel(status: InstallerLeadStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? "New";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatOptionalDate(value?: string | null) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTimeInputValue(value?: string | null) {
  const date = value ? new Date(value) : addHours(new Date(), 24);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
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

function escapeCsvCell(value: string) {
  const needsEscaping = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsEscaping ? `"${escaped}"` : escaped;
}

function normalizeInstallerStatus(value?: string | null): InstallerLeadStatus | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "quote-requested") {
    return "quoted";
  }

  if (
    normalized === "new" ||
    normalized === "contacted" ||
    normalized === "quoted" ||
    normalized === "closed-won" ||
    normalized === "closed-lost"
  ) {
    return normalized;
  }

  return null;
}

function normalizeFollowUpStatus(value?: string | null): InstallerFollowUpStatus {
  const normalized = (value ?? "").trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "report-sent" || normalized === "sent") {
    return "Report sent";
  }

  if (
    normalized === "first-follow-up-due" ||
    normalized === "follow-up-due" ||
    normalized === "queued" ||
    normalized === "scheduled"
  ) {
    return "First follow-up due";
  }

  if (normalized === "contacted") {
    return "Contacted";
  }

  if (normalized === "quote-requested" || normalized === "quoted") {
    return "Quote requested";
  }

  if (normalized === "closed" || normalized === "closed-won") {
    return "Closed";
  }

  if (normalized === "lost" || normalized === "closed-lost") {
    return "Lost";
  }

  return "Not started";
}

function getFollowUpActionLabel(action: FollowUpAction): InstallerFollowUpStatus {
  const labels: Record<FollowUpAction, InstallerFollowUpStatus> = {
    "first-follow-up-due": "First follow-up due",
    "quote-requested": "Quote requested",
    "report-sent": "Report sent",
    closed: "Closed",
    contacted: "Contacted",
    lost: "Lost",
  };

  return labels[action];
}

function getDefaultNextFollowUp(action: FollowUpAction) {
  if (action === "report-sent" || action === "first-follow-up-due") {
    return addHours(new Date(), 24).toISOString();
  }

  if (action === "contacted") {
    return addDays(new Date(), 3).toISOString();
  }

  return null;
}

function getStampedContactDate(action: FollowUpAction, lead: InstallerLead) {
  return action === "report-sent" ||
    action === "contacted" ||
    action === "quote-requested" ||
    action === "closed" ||
    action === "lost"
    ? new Date().toISOString()
    : lead.lastContactedAt;
}

function getRecommendedSequence(lead: InstallerLead) {
  const steps = [
    { stepOrder: 1, timing: "Immediately", title: "Report ready email" },
    { stepOrder: 2, timing: "24 hours after report", title: "24-hour follow-up" },
    { stepOrder: 3, timing: "3 days after report", title: "3-day savings reminder" },
    { stepOrder: 4, timing: "7 days after report", title: "7-day quote CTA" },
  ];

  return steps.map((step) => {
    const stored = lead.followUpSteps.find(
      (followUpStep) => followUpStep.stepOrder === step.stepOrder
    );

    return {
      ...step,
      status: getSequenceStatusLabel(stored?.status),
    };
  });
}

function getUpdatedFollowUpSteps(
  steps: InstallerFollowUpStep[],
  action: FollowUpAction,
  nextFollowUpAt?: string | null
) {
  if (
    action !== "report-sent" &&
    action !== "first-follow-up-due" &&
    action !== "contacted"
  ) {
    return steps;
  }

  const now = new Date().toISOString();
  const stepOrder =
    action === "report-sent" ? 1 : action === "contacted" ? 2 : 2;
  const title =
    stepOrder === 1
      ? "Report ready email"
      : action === "contacted"
        ? "24-hour follow-up"
        : "24-hour follow-up";
  const status = action === "first-follow-up-due" ? "queued" : "sent";
  const existing = steps.find((step) => step.stepOrder === stepOrder);
  const updatedStep: InstallerFollowUpStep = {
    channel: existing?.channel ?? (stepOrder === 2 ? "sms" : "email"),
    deliveryMessage:
      action === "first-follow-up-due"
        ? existing?.deliveryMessage ?? null
        : "Updated manually in installer dashboard.",
    processedAt: action === "first-follow-up-due" ? existing?.processedAt ?? null : now,
    scheduledFor:
      nextFollowUpAt ??
      existing?.scheduledFor ??
      (stepOrder === 2 ? addHours(new Date(), 24).toISOString() : now),
    status,
    stepOrder,
    title,
  };

  return [...steps.filter((step) => step.stepOrder !== stepOrder), updatedStep].sort(
    (a, b) => a.stepOrder - b.stepOrder
  );
}

function getSequenceStatusLabel(status?: string | null) {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "sent") return "sent";
  if (normalized === "failed") return "failed";
  if (normalized === "skipped") return "skipped";
  if (normalized === "scheduled") return "scheduled";
  if (normalized === "queued") return "queued";
  return "pending";
}

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
