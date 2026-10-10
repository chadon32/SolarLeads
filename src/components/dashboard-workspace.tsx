"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ChartNoAxesCombined,
  Columns3,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type {
  DashboardCrmFollowUp,
  DashboardCrmLead,
} from "@/components/dashboard-crm";
import type {
  DashboardAnalytics,
  DashboardPeriod,
  DashboardView,
} from "@/lib/dashboard-analytics";
import { formatName } from "@/lib/name-format";
import { formatDisplayAddress } from "@/lib/address-format";
import { LEAD_STATUS_OPTIONS, type LeadStatus } from "@/lib/lead-status";

const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pipeline", label: "Lead pipeline", icon: Columns3 },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { id: "follow-ups", label: "Follow-ups", icon: Send },
] as const;

export const dashboardMoney = (value: number | null) =>
  value === null
    ? "Not captured"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
const integer = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
const stageLabel = (status: LeadStatus) =>
  LEAD_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? "New";

export function DashboardWorkspace({
  view,
  onNavigate,
  period,
  onPeriodChange,
  includeTests,
  onIncludeTestsChange,
  onExport,
  onRefresh,
  onSignOut,
  isRefreshing,
  loadedCount,
  totalCount,
  asOf,
  children,
}: {
  view: DashboardView;
  onNavigate: (view: DashboardView) => void;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  includeTests: boolean;
  onIncludeTestsChange: (value: boolean) => void;
  onExport: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  isRefreshing: boolean;
  loadedCount: number;
  totalCount: number;
  asOf: string;
  children: ReactNode;
}) {
  const current = views.find((item) => item.id === view)!;
  return (
    <main className="solar-workspace" id="solar-workspace">
      <aside className="crm-sidebar">
        <div className="crm-brand-row">
          <Link
            className="crm-brand"
            href="/"
            aria-label="Solartelligence home"
          >
            <span className="crm-brand-mark">
              <Sun size={21} aria-hidden="true" />
            </span>
            <span>
              Solartelligence<small>Operations workspace</small>
            </span>
          </Link>
          <button
            className="crm-mobile-signout crm-icon-button"
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
        <p className="crm-nav-label">WORKSPACE</p>
        <nav className="crm-navigation" aria-label="Dashboard views">
          {views.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`/dashboard?view=${id}`}
              aria-current={view === id ? "page" : undefined}
              onClick={(event) => {
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  event.button === 0
                ) {
                  event.preventDefault();
                  onNavigate(id);
                }
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {view === id ? <span className="crm-active-mark" /> : null}
            </a>
          ))}
        </nav>
        <div className="crm-sidebar-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <strong>Private by design</strong>
          <p>Lead details stay behind your secure dashboard session.</p>
        </div>
        <div className="crm-sidebar-bottom">
          <Link href="/">
            Back to website <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button type="button" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className="crm-main">
        <div className="crm-topline">
          <span>
            PRIVATE OPERATIONS <span className="crm-topline-divider">/</span>{" "}
            {current.label}
          </span>
          <span>Phoenix time</span>
        </div>
        <header className="crm-page-header">
          <div>
            <p className="crm-eyebrow">SOLAR LEAD INTELLIGENCE</p>
            <h1>{current.label}</h1>
            <p>
              {view === "overview"
                ? "A clear view of your leads, priorities, and next moves."
                : view === "pipeline"
                  ? "Every homeowner. Every stage. One place to move work forward."
                  : view === "analytics"
                    ? "Understand your captured leads without guessing at the numbers."
                    : "Keep delivery issues and scheduled outreach in view."}
            </p>
          </div>
          <div className="crm-header-actions">
            <button
              type="button"
              className="crm-icon-button"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh dashboard"
            >
              <RefreshCw
                size={17}
                className={isRefreshing ? "crm-spinning" : ""}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="crm-button crm-button-primary"
              onClick={onExport}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              Export view
            </button>
          </div>
        </header>
        <div className="crm-scope-bar">
          <label>
            Submitted{" "}
            <select
              aria-label="Submission period"
              value={period}
              onChange={(event) =>
                onPeriodChange(event.target.value as DashboardPeriod)
              }
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All loaded records</option>
            </select>
          </label>
          <label className="crm-checkbox">
            <input
              type="checkbox"
              checked={includeTests}
              onChange={(event) => onIncludeTestsChange(event.target.checked)}
            />
            Include test leads
          </label>
          <span className="crm-freshness">
            Loaded{" "}
            {new Intl.DateTimeFormat("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/Phoenix",
            }).format(new Date(asOf))}
          </span>
        </div>
        {totalCount > loadedCount ? (
          <p className="crm-coverage-note" role="status">
            Showing the newest {integer(loadedCount)} of {integer(totalCount)}{" "}
            saved leads. Charts, filters, and exports cover these loaded
            records, not the entire history.
          </p>
        ) : null}
        {children}
        <footer className="crm-footer">
          <span>Solartelligence / Operations</span>
          <span>
            Modeled system values are not booked revenue. Test leads are
            excluded unless enabled.
          </span>
        </footer>
      </div>
    </main>
  );
}

export function DashboardMetrics({
  analytics,
}: {
  analytics: DashboardAnalytics;
}) {
  return (
    <section className="crm-metrics" aria-label="Lead performance summary">
      <Metric
        label="Captured leads"
        value={integer(analytics.total)}
        detail={`${analytics.today} submitted today`}
      />
      <Metric
        label="Open opportunities"
        value={integer(analytics.open)}
        detail="New, contacted, or quote requested"
      />
      <Metric
        label="Open modeled value"
        value={
          analytics.openValue === null
            ? "Not captured"
            : dashboardMoney(analytics.openValue)
        }
        detail={`Cost captured on ${analytics.openValueKnown} of ${analytics.open} open leads`}
      />
      <Metric
        label="Closed-lead win rate"
        value={
          analytics.winRate === null
            ? "No closed leads"
            : `${Math.round(analytics.winRate)}%`
        }
        detail={`${analytics.won} won / ${analytics.won + analytics.lost} closed`}
      />
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="crm-metric">
      <p>{label}</p>
      <strong className={value.length > 12 ? "crm-metric-long" : undefined}>
        {value}
      </strong>
      <small>{detail}</small>
    </article>
  );
}

export function SubmissionChart({
  analytics,
}: {
  analytics: DashboardAnalytics;
}) {
  const width = 640,
    height = 160;
  const max = Math.max(1, ...analytics.trend.map((item) => item.count));
  const points = analytics.trend
    .map(
      (item, index) =>
        `${(index / Math.max(1, analytics.trend.length - 1)) * width},${height - (item.count / max) * (height - 16)}`,
    )
    .join(" ");
  const total = analytics.trend.reduce((sum, item) => sum + item.count, 0);
  return (
    <section
      className="crm-panel crm-chart-panel"
      aria-labelledby="submission-chart-title"
    >
      <div className="crm-panel-heading">
        <div>
          <h2 id="submission-chart-title">Lead activity</h2>
          <p>Daily submissions over the last {analytics.trendDays} days</p>
        </div>
        <span className="crm-chart-total">
          {total}
          <small>submissions</small>
        </span>
      </div>
      <div className="crm-chart">
        <span className="crm-chart-max">{max}</span>
        <svg
          viewBox={`0 0 ${width} ${height + 4}`}
          role="img"
          aria-label={`${total} lead submissions over ${analytics.trendDays} days. Expand the data table for daily counts.`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="crm-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4de2ef" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#4de2ef" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((position) => (
            <line
              key={position}
              x1="0"
              x2={width}
              y1={position * height}
              y2={position * height}
              stroke="#273642"
              strokeDasharray="3 5"
            />
          ))}
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill="url(#crm-trend-fill)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#4de2ef"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {total === 0 ? (
          <p className="crm-chart-empty">No submissions in this period</p>
        ) : null}
        <div className="crm-chart-labels">
          {[
            0,
            Math.floor(analytics.trend.length / 2),
            analytics.trend.length - 1,
          ].map((index) => (
            <span key={index}>{dayLabel(analytics.trend[index].day)}</span>
          ))}
        </div>
      </div>
      <details className="crm-chart-data">
        <summary>View daily counts</summary>
        <div tabIndex={0} aria-label="Daily submission data">
          <table>
            <thead>
              <tr>
                <th>Date (Phoenix)</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {analytics.trend.map((item) => (
                <tr key={item.day}>
                  <td>{item.day}</td>
                  <td>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function PipelineSnapshot({
  analytics,
  onStage,
}: {
  analytics: DashboardAnalytics;
  onStage: (status: LeadStatus) => void;
}) {
  return (
    <section className="crm-panel" aria-labelledby="pipeline-snapshot-title">
      <div className="crm-panel-heading">
        <div>
          <h2 id="pipeline-snapshot-title">Pipeline snapshot</h2>
          <p>Current stages, not historical funnel progression</p>
        </div>
        <Columns3 size={18} aria-hidden="true" />
      </div>
      <div className="crm-stage-bars">
        {analytics.stages
          .filter((stage) => stage.id !== "test-lead" || stage.count > 0)
          .map((stage) => (
            <button
              type="button"
              className="crm-stage-bar"
              key={stage.id}
              onClick={() => onStage(stage.id)}
            >
              <span>
                <i className={`crm-stage-dot crm-tone-${stage.id}`} />
                {stage.label}
                <strong>{stage.count}</strong>
              </span>
              <span className="crm-bar-track">
                <span
                  className={`crm-bar-fill crm-tone-${stage.id}`}
                  style={{
                    width: `${analytics.total ? (stage.count / analytics.total) * 100 : 0}%`,
                  }}
                />
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}

export function DashboardOverview({
  analytics,
  leads,
  failedCount,
  onNavigate,
  onSelect,
  onStage,
  onStale,
}: {
  analytics: DashboardAnalytics;
  leads: DashboardCrmLead[];
  failedCount: number | null;
  onNavigate: (view: DashboardView) => void;
  onSelect: (id: string) => void;
  onStage: (status: LeadStatus) => void;
  onStale: () => void;
}) {
  return (
    <div className="crm-view-content">
      <DashboardMetrics analytics={analytics} />
      <div className="crm-overview-grid">
        <SubmissionChart analytics={analytics} />
        <PipelineSnapshot analytics={analytics} onStage={onStage} />
      </div>
      <section className="crm-priorities" aria-label="Needs attention">
        <button onClick={() => onStage("new")}>
          <span className="crm-priority-count">
            {analytics.newLeads.length}
          </span>
          <span>
            <strong>New leads to review</strong>
            <small>Make the first move</small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <button onClick={onStale}>
          <span className="crm-priority-count">{analytics.stale.length}</span>
          <span>
            <strong>Open leads untouched 7+ days</strong>
            <small>Based on saved record timestamps</small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <button onClick={() => onNavigate("follow-ups")}>
          <span className="crm-priority-count">{failedCount ?? "?"}</span>
          <span>
            <strong>Follow-ups needing attention</strong>
            <small>
              {failedCount === null
                ? "Delivery data unavailable"
                : "Failed or awaiting review"}
            </small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </section>
      <section className="crm-panel">
        <div className="crm-panel-heading">
          <div>
            <h2>Recent homeowners</h2>
            <p>The latest leads in your selected period</p>
          </div>
          <button
            className="crm-text-button"
            onClick={() => onNavigate("pipeline")}
          >
            View pipeline <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        {leads.length ? (
          <div className="crm-recent-list">
            {leads.slice(0, 5).map((lead) => (
              <button key={lead.id} onClick={() => onSelect(lead.id)}>
                <span className="crm-avatar">
                  {(formatName(lead.name) || "H").slice(0, 1)}
                </span>
                <span className="crm-recent-person">
                  <strong>{formatName(lead.name) || "Homeowner"}</strong>
                  <small>{formatDisplayAddress(lead.address)}</small>
                </span>
                <span className={`crm-status-pill crm-tone-${lead.status}`}>
                  {stageLabel(lead.status)}
                </span>
                <span className="crm-recent-value">
                  {dashboardMoney(lead.systemCostBeforeIncentives)}
                  <small>modeled system cost</small>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <div className="crm-empty">
            <strong>No leads in this period</strong>
            <p>
              Choose a longer period or include test leads. New homeowner
              reports will appear here.
            </p>
          </div>
        )}
      </section>
      <div className="crm-signal-strip">
        <span>
          <strong>{analytics.reportsReady}</strong> reports marked ready
        </span>
        <span>
          <strong>{analytics.billsUploaded}</strong> utility bills uploaded
        </span>
        <span>
          <strong>{analytics.completeModels}</strong> complete saved models
        </span>
        <span>
          <strong>{analytics.referrals}</strong> referral-linked leads
        </span>
      </div>
    </div>
  );
}

export function DashboardAnalyticsView({
  analytics,
}: {
  analytics: DashboardAnalytics;
}) {
  const maxBrand = Math.max(1, ...analytics.brands.map((item) => item.count));
  return (
    <div className="crm-view-content">
      <DashboardMetrics analytics={analytics} />
      <SubmissionChart analytics={analytics} />
      <div className="crm-overview-grid">
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>Equipment interest</h2>
              <p>Panel brands saved with homeowner reports</p>
            </div>
          </div>
          {analytics.brands.length ? (
            <div className="crm-breakdown">
              {analytics.brands.map((brand) => (
                <div key={brand.label}>
                  <span>
                    {brand.label}
                    <strong>{brand.count}</strong>
                  </span>
                  <span className="crm-bar-track">
                    <span
                      className="crm-bar-fill"
                      style={{ width: `${(brand.count / maxBrand) * 100}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="crm-empty">No equipment selections captured.</p>
          )}
        </section>
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>Report completeness</h2>
              <p>Uploaded does not mean a utility bill was verified</p>
            </div>
          </div>
          <dl className="crm-data-list">
            <div>
              <dt>Reports marked ready</dt>
              <dd>
                {analytics.reportsReady} / {analytics.total}
              </dd>
            </div>
            <div>
              <dt>Utility bill attached</dt>
              <dd>
                {analytics.billsUploaded} / {analytics.total}
              </dd>
            </div>
            <div>
              <dt>Complete saved model</dt>
              <dd>
                {analytics.completeModels} / {analytics.total}
              </dd>
            </div>
            <div>
              <dt>Referral-linked</dt>
              <dd>
                {analytics.referrals} / {analytics.total}
              </dd>
            </div>
            <div>
              <dt>Average annual savings (known)</dt>
              <dd>{dashboardMoney(analytics.averageSavings)}</dd>
            </div>
            <div>
              <dt>Average lead score (known)</dt>
              <dd>
                {analytics.averageScore === null
                  ? "Not captured"
                  : `${Math.round(analytics.averageScore)}/100`}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <p className="crm-method-note">
        <strong>What these numbers mean</strong> Filters select a
        submission-date cohort in Phoenix time. Statuses are its current saved
        stages. Win rate = won / (won + lost), not website conversion. System
        costs are preliminary modeled values, not sales revenue. Missing values
        are excluded from averages; no website visitor or campaign data is
        assumed.
      </p>
    </div>
  );
}

export function DashboardFollowUps({
  followUps,
  leads,
  available,
  totalCount,
  onSelect,
  onSend,
}: {
  followUps: DashboardCrmFollowUp[];
  leads: DashboardCrmLead[];
  available: boolean;
  totalCount: number | null;
  onSelect: (id: string) => void;
  onSend: (followUp: DashboardCrmFollowUp) => void;
}) {
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Delivery queue</h2>
          <p>
            Only outreach already saved for the selected lead cohort. Nothing is
            sent automatically by this view.
          </p>
        </div>
        <span className="crm-count-badge">{followUps.length}</span>
      </div>
      {available && totalCount !== null && totalCount > followUps.length ? (
        <p className="crm-method-note">
          There are {totalCount} saved follow-up records in total. This view
          shows only loaded entries matching your lead cohort.
        </p>
      ) : null}
      {!available ? (
        <div className="crm-empty" role="status">
          <strong>Follow-up data unavailable</strong>
          <p>
            The queue could not be loaded. Refresh the dashboard or check the
            follow-up table configuration.
          </p>
        </div>
      ) : !followUps.length ? (
        <div className="crm-empty">
          <strong>No follow-ups in this view</strong>
          <p>
            No saved outreach matches the selected period and test-lead setting.
          </p>
        </div>
      ) : (
        <div className="crm-followup-list">
          {followUps.map((followUp) => {
            const lead = leadMap.get(followUp.leadId);
            const isTest = lead?.status === "test-lead";
            const canSend =
              lead &&
              !isTest &&
              (followUp.status === "queued" || followUp.status === "scheduled");
            return (
              <article key={followUp.id}>
                <div>
                  <span
                    className={`crm-status-pill ${["failed", "needs_review"].includes(followUp.status) ? "crm-tone-closed-lost" : "crm-tone-contacted"}`}
                  >
                    {followUp.status.replaceAll("_", " ")}
                  </span>
                  <h3>{followUp.title}</h3>
                  <button
                    className="crm-text-button"
                    onClick={() => onSelect(followUp.leadId)}
                  >
                    {formatName(lead?.name ?? "") || "View homeowner"}
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                  <p>{followUp.message}</p>
                  {isTest ? (
                    <p className="crm-delivery-message">
                      Test lead: outreach is disabled.
                    </p>
                  ) : followUp.deliveryMessage ? (
                    <p className="crm-delivery-message">
                      {followUp.deliveryMessage}
                    </p>
                  ) : null}
                  <small>
                    {Number.isFinite(Date.parse(followUp.scheduledFor))
                      ? new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "America/Phoenix",
                        }).format(new Date(followUp.scheduledFor))
                      : "Schedule not captured"}{" "}
                    / {followUp.channel}
                  </small>
                </div>
                {canSend ? (
                  <button
                    className="crm-button crm-button-secondary"
                    onClick={() => onSend(followUp)}
                  >
                    <Send size={15} aria-hidden="true" />
                    Send now
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function DashboardPipelineBoard({
  leads,
  selectedId,
  updatingIds,
  includeTests,
  onSelect,
  onStatusChange,
}: {
  leads: DashboardCrmLead[];
  selectedId: string;
  updatingIds: Set<string>;
  includeTests: boolean;
  onSelect: (id: string) => void;
  onStatusChange: (lead: DashboardCrmLead, status: LeadStatus) => void;
}) {
  return (
    <div className="crm-board" aria-label="Lead pipeline board" tabIndex={0}>
      {LEAD_STATUS_OPTIONS.filter(
        (stage) => stage.id !== "test-lead" || includeTests,
      ).map((stage) => {
        const items = leads.filter((lead) => lead.status === stage.id);
        return (
          <section
            key={stage.id}
            className="crm-board-column"
            aria-label={`${stage.label} stage`}
          >
            <header>
              <i className={`crm-stage-dot crm-tone-${stage.id}`} />
              <h3>{stage.label}</h3>
              <span>{items.length}</span>
            </header>
            <div className="crm-board-cards">
              {items.map((lead) => (
                <article
                  key={lead.id}
                  className={`crm-board-card ${selectedId === lead.id ? "is-selected" : ""}`}
                >
                  <button
                    className="crm-card-open"
                    onClick={() => onSelect(lead.id)}
                  >
                    <span className="crm-avatar">
                      {(formatName(lead.name) || "H").slice(0, 1)}
                    </span>
                    <strong>{formatName(lead.name) || "Homeowner"}</strong>
                    <span>{formatDisplayAddress(lead.address)}</span>
                    <b>
                      {dashboardMoney(lead.systemCostBeforeIncentives)}
                      <small>modeled system cost</small>
                    </b>
                    <span className="crm-card-meta">
                      {lead.leadScore === null
                        ? "Score not captured"
                        : `Lead score ${lead.leadScore}/100`}
                      {lead.utilityBillUploaded ? " / Bill uploaded" : ""}
                    </span>
                  </button>
                  <label className="crm-card-stage">
                    Move to
                    <select
                      aria-label={`Status for ${formatName(lead.name) || "homeowner"}`}
                      disabled={updatingIds.has(lead.id)}
                      value={lead.status}
                      onChange={(event) =>
                        onStatusChange(lead, event.target.value as LeadStatus)
                      }
                    >
                      {LEAD_STATUS_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
            {items.length === 0 ? (
              <p className="crm-board-empty">No matching leads</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
