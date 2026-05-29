"use client";

import {
  Car,
  DollarSign,
  Grid3X3,
  Leaf,
  Sun,
  TreePine,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import {
  buildSolarMetrics,
  INSTALLED_COST_PER_WATT,
  STANDARD_PANEL_WATTS,
} from "@/lib/solar-metrics";

type SolarReportDashboardProps = {
  address: string;
  analysis: RoofAnalysis;
  activePanelCount?: number;
  monthlyBill?: number;
  onActivePanelCountChange?: (panelCount: number) => void;
  onMonthlyBillChange?: (monthlyBill: number) => void;
};

type DetailTab = "overview" | "savings" | "environment" | "financing" | "next";
type FinancingMode = "buy" | "lease" | "loan";
type MetricSource = "solar-api" | "modeled" | "user-adjusted" | "illustrative";

const monthlyBillOptions = [100, 150, 200, 250, 300, 350, 400, 450, 500];

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "savings", label: "Savings" },
  { id: "environment", label: "Environmental Impact" },
  { id: "financing", label: "Financing Assumptions" },
  { id: "next", label: "Next Steps" },
];

const financingCopy: Record<FinancingMode, string> = {
  buy:
    "Pay for the system up front and keep the long-term savings. Buying can work well for homeowners who want the cleanest path to ownership.",
  lease:
    "Use solar with a third-party owner handling system costs. A lease or PPA may reduce upfront cost, though long-term savings can be lower.",
  loan:
    "Own your system and pay over time. A loan is a great way to take advantage of incentives and long-term savings while spreading the cost across monthly payments.",
};

export function SolarReportDashboard({
  activePanelCount,
  address,
  analysis,
  monthlyBill: externalMonthlyBill = 200,
  onActivePanelCountChange,
  onMonthlyBillChange,
}: SolarReportDashboardProps) {
  const monthlyBill = externalMonthlyBill;
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [financingMode, setFinancingMode] = useState<FinancingMode>("loan");
  const values = useMemo(
    () => buildDashboardValues(analysis, monthlyBill, financingMode, activePanelCount),
    [activePanelCount, analysis, financingMode, monthlyBill]
  );

  const updateMonthlyBill = (value: number) => {
    onMonthlyBillChange?.(value);
  };

  return (
    <>
      <aside className="space-y-3 lg:col-span-5">
        <section className="rounded-[1.35rem] border border-cyan-200/12 bg-slate-950/72 p-4 shadow-[0_18px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Preliminary roof model ready
              </p>
              <h2 className="mt-2 line-clamp-2 text-lg font-semibold text-white">
                {address}
              </h2>
            </div>
            <SourceBadge source="solar-api" />
          </div>
          <p className="mt-3 text-sm leading-6 text-white/58">
            Estimated solar layout generated from available roof and sunlight data.
            Final panel placement, incentives, pricing, and savings require installer confirmation.
          </p>
        </section>

        <GuidedProgressStrip />

        <section className="grid grid-cols-2 gap-2.5">
          <KeyMetric
            icon={Sun}
            label="Sunlight"
            source="solar-api"
            value={`${formatNumber(values.sunlightHours)} hrs`}
            tone="gold"
          />
          <KeyMetric
            icon={Grid3X3}
            label="Solar area"
            source="solar-api"
            value={`${formatNumber(values.usableAreaSqFt)} sq ft`}
          />
          <KeyMetric
            icon={TrendingUp}
            label="20-year savings"
            source="modeled"
            value={formatMoney(values.twentyYearSavings)}
            tone="gold"
          />
          <KeyMetric
            icon={Zap}
            label="System size"
            source="user-adjusted"
            value={`${values.recommendedKw.toFixed(1)} kW`}
          />
        </section>

        <section className="rounded-[1.15rem] border border-white/12 bg-slate-950/68 p-4 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Fine-tune layout
              </p>
              <h3 className="mt-2 text-base font-semibold text-white">
                Panel count and bill input
              </h3>
            </div>
            <SourceBadge source="user-adjusted" />
          </div>
          <label className="mt-4 block">
            <div className="flex items-center justify-between gap-3 text-xs text-white/58">
              <span className="font-semibold uppercase tracking-[0.2em]">
                Accepted panels
              </span>
              <span className="font-semibold text-white">
                {values.panelCount} / {values.maxPanelCount}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={values.maxPanelCount}
              value={values.panelCount}
              onChange={(event) => onActivePanelCountChange?.(Number(event.target.value))}
              className="mt-2 w-full accent-cyan-300"
            />
          </label>
          {values.rejectedPanelCandidateCount > 0 ? (
            <p className="mt-2 text-xs leading-5 text-amber-100/85">
              {values.rejectedPanelCandidateCount} Solar API candidates were not placed due to
              spacing, overlap, or estimated setback limits.
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-white/46">
            Panels are placed from available roof candidate points and adjusted for spacing,
            setbacks, and overlap prevention.
          </p>
          <select
            value={monthlyBill}
            onChange={(event) => updateMonthlyBill(Number(event.target.value))}
            className="mt-4 w-full rounded-full border border-white/12 bg-black/35 px-4 py-3 text-base font-semibold text-white outline-none transition focus:border-cyan-200/50"
          >
            {monthlyBillOptions.map((value) => (
              <option key={value} value={value} className="bg-slate-950">
                {formatMoney(value)}
              </option>
            ))}
          </select>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniReadout label="Panel footprint" source="solar-api" value={`${formatNumber(values.installationSqFt)} sq ft`} />
            <MiniReadout label="Annual savings" source="user-adjusted" value={formatMoney(values.annualSavings)} />
          </div>
        </section>

        <DataProvenanceBlock />

        <a
          href="#contact"
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100"
        >
          Send My Full Report
        </a>
      </aside>

      <section
        id="report-dashboard"
        className="rounded-[1.5rem] border border-white/12 bg-slate-950/70 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-4 lg:col-span-12"
      >
        <div
          role="tablist"
          aria-label="Solar report detail sections"
          className="flex gap-2 overflow-x-auto rounded-full border border-white/10 bg-black/24 p-1"
        >
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                activeTab === tab.id
                  ? "bg-white text-slate-950"
                  : "text-white/58 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {activeTab === "overview" ? <OverviewTab values={values} /> : null}
          {activeTab === "savings" ? <SavingsTab values={values} /> : null}
          {activeTab === "environment" ? <EnvironmentalTab values={values} /> : null}
          {activeTab === "financing" ? (
            <FinancingTab
              financingMode={financingMode}
              onFinancingModeChange={setFinancingMode}
              values={values}
            />
          ) : null}
          {activeTab === "next" ? <NextStepsTab /> : null}
        </div>
      </section>
    </>
  );
}

function OverviewTab({
  values,
}: {
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <CompactInfo
        icon={Sun}
        source="solar-api"
        title={`${formatNumber(values.sunlightHours)} hours`}
        body="Usable sunlight per year based on the current roof profile."
        tone="gold"
      />
      <CompactInfo
        icon={Grid3X3}
        source="solar-api"
        title={`${values.panelCount} accepted panels`}
        body={`${formatNumber(values.usableAreaSqFt)} square feet available for solar panels.`}
      />
      <CompactInfo
        icon={DollarSign}
        source="modeled"
        title={formatMoney(values.twentyYearSavings)}
        body="Estimated net savings over 20 years."
        tone="gold"
      />
    </div>
  );
}

function SavingsTab({ values }: { values: DashboardValues }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <CompactInfo
          icon={Zap}
          source="user-adjusted"
          title={`${values.recommendedKw.toFixed(1)} kW`}
          body="Recommended installation size from the current roof and bill profile."
        />
        <CompactInfo
          icon={TrendingUp}
          source="user-adjusted"
          title={formatMoney(values.annualSavings)}
          body="Estimated average annual savings."
          tone="gold"
        />
      </div>
      <EstimateTable rows={values.savingsRows} />
    </div>
  );
}

function EnvironmentalTab({ values }: { values: DashboardValues }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <CompactInfo
        icon={Leaf}
        source="modeled"
        title={`${values.carbonMetricTons.toFixed(1)} metric tons`}
        body="Carbon dioxide avoided annually."
        tone="gold"
      />
      <CompactInfo
        icon={Car}
        source="modeled"
        title={`${values.carsRemoved.toFixed(1)} cars`}
        body="Passenger cars removed from the road for one year."
      />
      <CompactInfo
        icon={TreePine}
        source="modeled"
        title={`${values.treesEquivalent.toFixed(1)} trees`}
        body="Trees grown for 10 years equivalent."
        tone="gold"
      />
    </div>
  );
}

function FinancingTab({
  financingMode,
  onFinancingModeChange,
  values,
}: {
  financingMode: FinancingMode;
  onFinancingModeChange: (value: FinancingMode) => void;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
        <div className="grid grid-cols-3 rounded-full border border-white/10 bg-black/24 p-1">
          {(["buy", "lease", "loan"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFinancingModeChange(mode)}
              className={`rounded-full px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] transition ${
                financingMode === mode
                  ? "bg-white text-slate-950"
                  : "text-white/58 hover:text-white"
              }`}
            >
              {mode === "lease" ? "Lease" : mode}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm leading-7 text-white/62">
          {financingCopy[financingMode]}
        </p>
        <p className="mt-3 text-xs leading-5 text-amber-100/78">
          Financing values are illustrative only. Final pricing, incentives, APR,
          and terms require installer and lender confirmation.
        </p>
        <p className="mt-2 text-xs leading-5 text-white/48">
          These fields are read-only outputs. Adjust the monthly bill and panel
          count in the estimate controls to update the model.
        </p>
        <div className="mt-4 grid gap-2">
          <MiniReadout
            label="Upfront after incentives"
            note={
              financingMode === "buy"
                ? "Cash purchase estimate after incentive placeholder."
                : "Assumes no upfront payment for this financing type."
            }
            source="illustrative"
            value={formatMoney(values.upfrontAfterIncentives)}
          />
          <MiniReadout label="20-year savings" source="illustrative" value={formatMoney(values.totalSavings)} />
        </div>
        <AssumptionTable rows={values.financingAssumptions} />
      </div>
      <EstimateTable rows={values.financingRows} />
    </div>
  );
}

function NextStepsTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <h3 className="text-2xl font-semibold text-white">Ready to get started?</h3>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-white/62">
          Review your solar report, compare your options, and connect with a
          solar provider when you are ready.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        <a
          href="#contact"
          className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
        >
          Send My Full Report
        </a>
        <a
          href="#how-it-works"
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-black/20 px-5 py-3 text-sm font-semibold text-white/76 transition hover:text-white"
        >
          Learn About Going Solar
        </a>
      </div>
    </div>
  );
}

function GuidedProgressStrip() {
  const steps = [
    "Roof found",
    "Solar-ready area estimated",
    "Panel layout generated",
    "Savings modeled",
  ];

  return (
    <section className="rounded-[1.05rem] border border-white/10 bg-black/24 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center gap-2 text-xs text-white/62">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cyan-200/20 bg-cyan-200/10 text-[0.65rem] font-semibold text-cyan-100">
              {index + 1}
            </span>
            <span>{step}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataProvenanceBlock() {
  return (
    <section className="rounded-[1.05rem] border border-white/10 bg-black/24 p-3 text-xs leading-5 text-white/54">
      <p className="font-semibold uppercase tracking-[0.24em] text-cyan-100/78">
        Data sources
      </p>
      <p className="mt-2">
        Roof geometry, imagery, sunlight, and panel candidates: Google Solar API.
        Savings, cost, bill offset, and financing: modeled estimates using Arizona
        assumptions and user inputs.
      </p>
    </section>
  );
}

function SourceBadge({ source }: { source: MetricSource }) {
  const styles: Record<MetricSource, string> = {
    "solar-api": "border-cyan-200/18 bg-cyan-200/10 text-cyan-100",
    modeled: "border-amber-200/18 bg-amber-200/10 text-amber-100",
    "user-adjusted": "border-emerald-200/18 bg-emerald-200/10 text-emerald-100",
    illustrative: "border-slate-200/18 bg-white/8 text-slate-200",
  };
  const labels: Record<MetricSource, string> = {
    "solar-api": "Solar API",
    modeled: "Modeled",
    "user-adjusted": "User-adjusted",
    illustrative: "Illustrative",
  };

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.56rem] font-semibold uppercase tracking-[0.16em] ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

function KeyMetric({
  icon: Icon,
  label,
  source,
  value,
  tone = "cyan",
}: {
  icon: LucideIcon;
  label: string;
  source: MetricSource;
  value: string;
  tone?: "cyan" | "gold";
}) {
  const accent =
    tone === "gold"
      ? "bg-amber-200/12 text-amber-100"
      : "bg-cyan-200/12 text-cyan-100";

  return (
    <div className="liquid-glass rounded-[1.2rem] p-3">
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${accent}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-white/45">
          {label}
        </span>
      </div>
      <div className="mt-2">
        <SourceBadge source={source} />
      </div>
      <p className="mt-3 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function CompactInfo({
  icon: Icon,
  source,
  title,
  body,
  tone = "cyan",
}: {
  icon: LucideIcon;
  source: MetricSource;
  title: string;
  body: string;
  tone?: "cyan" | "gold";
}) {
  const accent =
    tone === "gold"
      ? "bg-amber-200/12 text-amber-100"
      : "bg-cyan-200/12 text-cyan-100";

  return (
    <article className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${accent}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="mt-3">
        <SourceBadge source={source} />
      </div>
      <h3 className="mt-4 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/56">{body}</p>
    </article>
  );
}

function MiniReadout({
  label,
  note,
  source,
  value,
}: {
  label: string;
  note?: string;
  source: MetricSource;
  value: string;
}) {
  return (
    <div className="rounded-[0.9rem] border border-white/10 bg-black/22 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/42">
          {label}
        </p>
        <SourceBadge source={source} />
      </div>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-white/44">{note}</p> : null}
    </div>
  );
}

function EstimateTable({
  rows,
}: {
  rows: Array<{ label: string; source: MetricSource; value: number }>;
}) {
  return (
    <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-black/20">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 border-b border-white/8 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <span className="flex flex-wrap items-center gap-2 text-sm text-white/58">
            {row.label}
            <SourceBadge source={row.source} />
          </span>
          <span className="text-base font-semibold text-white">
            {formatMoney(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssumptionTable({
  rows,
}: {
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-[0.9rem] border border-white/10 bg-black/20">
      <div className="border-b border-white/8 px-3 py-2">
        <p className="text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-white/42">
          Estimate assumptions
        </p>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 border-b border-white/8 px-3 py-2.5 last:border-b-0 sm:grid-cols-[1fr_auto]"
        >
          <span className="text-xs text-white/54">{row.label}</span>
          <span className="text-xs font-semibold text-white">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

type DashboardValues = ReturnType<typeof buildDashboardValues>;

function buildDashboardValues(
  analysis: RoofAnalysis,
  monthlyBill: number,
  financingMode: FinancingMode,
  activePanelCount?: number
) {
  const baseMetrics = buildSolarMetrics(analysis);
  const maxPanelCount = Math.max(1, baseMetrics.maxPanelCount);
  const panelCount = Math.round(
    clamp(activePanelCount || maxPanelCount, 1, maxPanelCount)
  );
  const metrics = buildSolarMetrics(analysis, {
    monthlyBill,
    selectedPanelCount: panelCount,
  });
  const usableAreaSqFt = Math.round(metrics.usableRoofAreaM2 * 10.7639);
  const rejectedPanelCandidateCount = metrics.rejectedCandidateCount;
  const annualKwh = metrics.annualKwh;
  const recommendedKw = metrics.systemKw;
  const annualSavings = metrics.annualSavings;
  const twentyYearSavings = Math.round(annualSavings * 20);
  const panelAreaSqFt =
    analysis.panelWidthMeters > 0 && analysis.panelHeightMeters > 0
      ? analysis.panelWidthMeters * analysis.panelHeightMeters * 10.7639
      : 20;
  const installationSqFt = Math.round(
    clamp(
      panelCount * panelAreaSqFt,
      Math.min(usableAreaSqFt, 120),
      Math.max(usableAreaSqFt, panelCount * panelAreaSqFt)
    )
  );
  const carbonMetricTons = roundTo(metrics.co2OffsetLbs / 2205, 1);
  const carsRemoved = roundTo(carbonMetricTons / 4.6, 1);
  const treesEquivalent = roundTo(carbonMetricTons * 16.7, 1);
  const azRatePerKwh = 0.13;
  const buyIncentiveRate = 0.3;
  const utilityEscalationRate = 0.03;
  const loanPaymentMultiplier = 1.38;
  const installedCost = Math.round(panelCount * STANDARD_PANEL_WATTS * INSTALLED_COST_PER_WATT);
  const totalCostWithoutSolar = Math.round(
    Array.from({ length: 20 }).reduce<number>(
      (sum, _, year) => sum + monthlyBill * 12 * (1 + utilityEscalationRate) ** year,
      0
    )
  );
  const upfrontAfterIncentives =
    financingMode === "buy" ? Math.round(installedCost * (1 - buyIncentiveRate)) : 0;
  const totalPayments =
    financingMode === "buy"
      ? upfrontAfterIncentives
      : financingMode === "lease"
        ? Math.round(Math.max(totalCostWithoutSolar - twentyYearSavings * 0.55, 0))
        : Math.round(installedCost * loanPaymentMultiplier);
  const totalCostWithSolar = Math.max(totalCostWithoutSolar - twentyYearSavings, totalPayments);
  const totalSavings = Math.max(totalCostWithoutSolar - totalCostWithSolar, 0);

  return {
    annualKwh,
    annualSavings,
    carbonMetricTons,
    carsRemoved,
    financingRows: [
      { label: "Up-front cost of installation", source: "illustrative" as const, value: upfrontAfterIncentives },
      { label: "Total payments over 20 years", source: "illustrative" as const, value: totalPayments },
      { label: "Total 20-year cost with solar", source: "illustrative" as const, value: totalCostWithSolar },
      { label: "Total 20-year cost without solar", source: "modeled" as const, value: totalCostWithoutSolar },
      { label: "Total 20-year savings", source: "illustrative" as const, value: totalSavings },
    ],
    financingAssumptions: [
      { label: "Arizona electricity rate", value: `$${azRatePerKwh.toFixed(2)}/kWh` },
      { label: "Installed cost basis", value: `$${INSTALLED_COST_PER_WATT.toFixed(2)}/W` },
      { label: "Utility escalation", value: `${Math.round(utilityEscalationRate * 100)}% / yr` },
      { label: "Buy incentive placeholder", value: `${Math.round(buyIncentiveRate * 100)}%` },
      { label: "Loan payment multiplier", value: `${loanPaymentMultiplier.toFixed(2)}x installed cost` },
    ],
    installationSqFt,
    maxPanelCount,
    panelCount,
    recommendedKw,
    rejectedPanelCandidateCount,
    savingsRows: [
      { label: "Average annual savings", source: "user-adjusted" as const, value: annualSavings },
      { label: "Total 20-year cost with solar", source: "illustrative" as const, value: totalCostWithSolar },
      { label: "Total 20-year cost without solar", source: "modeled" as const, value: totalCostWithoutSolar },
      { label: "Total 20-year savings", source: "modeled" as const, value: totalSavings },
    ],
    sunlightHours: analysis.annualSunlightHours,
    totalSavings,
    treesEquivalent,
    twentyYearSavings,
    upfrontAfterIncentives,
    usableAreaSqFt,
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
