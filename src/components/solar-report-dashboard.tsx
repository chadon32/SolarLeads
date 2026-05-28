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
import { getUsableAreaM2, type RoofAnalysis } from "@/lib/roof-analysis";

type SolarReportDashboardProps = {
  address: string;
  analysis: RoofAnalysis;
};

type DetailTab = "overview" | "savings" | "environment" | "financing" | "next";
type FinancingMode = "buy" | "lease" | "loan";

const monthlyBillOptions = [100, 150, 200, 250, 300, 350, 400, 450, 500];

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "savings", label: "Savings" },
  { id: "environment", label: "Environmental Impact" },
  { id: "financing", label: "Financing" },
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
  address,
  analysis,
}: SolarReportDashboardProps) {
  const [monthlyBill, setMonthlyBill] = useState(300);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [financingMode, setFinancingMode] = useState<FinancingMode>("loan");
  const values = useMemo(
    () => buildDashboardValues(analysis, monthlyBill, financingMode),
    [analysis, financingMode, monthlyBill]
  );

  return (
    <>
      <aside className="space-y-4 lg:col-span-5">
        <section className="liquid-glass rounded-[1.35rem] p-4 shadow-[0_18px_65px_rgba(0,0,0,0.34)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Report ready
              </p>
              <h2 className="mt-2 line-clamp-2 text-lg font-semibold text-white">
                {address}
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-200/15 bg-emerald-200/10 px-2.5 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-emerald-100">
              {values.sourceLabel}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/58">
            Analysis complete. Your roof has a usable solar layout, modeled
            production, and a homeowner-ready savings estimate.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <KeyMetric
            icon={Sun}
            label="Sunlight"
            value={`${formatNumber(values.sunlightHours)} hrs`}
            tone="gold"
          />
          <KeyMetric
            icon={Grid3X3}
            label="Solar area"
            value={`${formatNumber(values.usableAreaSqFt)} ft²`}
          />
          <KeyMetric
            icon={TrendingUp}
            label="20-year savings"
            value={formatMoney(values.twentyYearSavings)}
            tone="gold"
          />
          <KeyMetric
            icon={Zap}
            label="System size"
            value={`${values.recommendedKw.toFixed(1)} kW`}
          />
        </section>

        <section className="liquid-glass rounded-[1.35rem] p-4 shadow-[0_18px_65px_rgba(0,0,0,0.3)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
                Fine-tune estimate
              </p>
              <h3 className="mt-2 text-base font-semibold text-white">
                Monthly electric bill
              </h3>
            </div>
            <span className="rounded-full border border-white/10 bg-black/24 px-2.5 py-1 text-xs font-semibold text-white/70">
              Est.
            </span>
          </div>
          <select
            value={monthlyBill}
            onChange={(event) => setMonthlyBill(Number(event.target.value))}
            className="mt-4 w-full rounded-full border border-white/12 bg-black/35 px-4 py-3 text-base font-semibold text-white outline-none transition focus:border-cyan-200/50"
          >
            {monthlyBillOptions.map((value) => (
              <option key={value} value={value} className="bg-slate-950">
                {formatMoney(value)}
              </option>
            ))}
          </select>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniReadout label="Panel footprint" value={`${formatNumber(values.installationSqFt)} ft²`} />
            <MiniReadout label="Annual savings" value={formatMoney(values.annualSavings)} />
          </div>
        </section>

        <a
          href="#contact"
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100"
        >
          Get My Free Estimate
        </a>
      </aside>

      <section
        id="report-dashboard"
        className="liquid-glass rounded-[1.5rem] p-3 shadow-[0_18px_70px_rgba(0,0,0,0.32)] sm:p-4 lg:col-span-12"
      >
        <div className="flex gap-2 overflow-x-auto rounded-full border border-white/10 bg-black/24 p-1">
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
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
          {activeTab === "overview" ? <OverviewTab analysis={analysis} values={values} /> : null}
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
  analysis,
  values,
}: {
  analysis: RoofAnalysis;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <CompactInfo
        icon={Sun}
        title={`${formatNumber(values.sunlightHours)} hours`}
        body="Usable sunlight per year based on the current roof profile."
        tone="gold"
      />
      <CompactInfo
        icon={Grid3X3}
        title={`${analysis.panelCount} panels`}
        body={`${formatNumber(values.usableAreaSqFt)} square feet available for solar panels.`}
      />
      <CompactInfo
        icon={DollarSign}
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
          title={`${values.recommendedKw.toFixed(1)} kW`}
          body="Recommended installation size from the current roof and bill profile."
        />
        <CompactInfo
          icon={TrendingUp}
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
        title={`${values.carbonMetricTons.toFixed(1)} metric tons`}
        body="Carbon dioxide avoided annually."
        tone="gold"
      />
      <CompactInfo
        icon={Car}
        title={`${values.carsRemoved.toFixed(1)} cars`}
        body="Passenger cars removed from the road for one year."
      />
      <CompactInfo
        icon={TreePine}
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
        <div className="mt-4 grid gap-2">
          <MiniReadout label="Upfront after incentives" value={formatMoney(values.upfrontAfterIncentives)} />
          <MiniReadout label="20-year savings" value={formatMoney(values.totalSavings)} />
        </div>
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
          Get My Free Estimate
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

function KeyMetric({
  icon: Icon,
  label,
  value,
  tone = "cyan",
}: {
  icon: LucideIcon;
  label: string;
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
      <p className="mt-3 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function CompactInfo({
  icon: Icon,
  title,
  body,
  tone = "cyan",
}: {
  icon: LucideIcon;
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
      <h3 className="mt-4 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/56">{body}</p>
    </article>
  );
}

function MiniReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.9rem] border border-white/10 bg-black/22 px-3 py-3">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/42">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function EstimateTable({
  rows,
}: {
  rows: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-black/20">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 border-b border-white/8 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <span className="text-sm text-white/58">{row.label}</span>
          <span className="text-base font-semibold text-white">
            {formatMoney(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

type DashboardValues = ReturnType<typeof buildDashboardValues>;

function buildDashboardValues(
  analysis: RoofAnalysis,
  monthlyBill: number,
  financingMode: FinancingMode
) {
  const usableAreaM2 = getUsableAreaM2(analysis);
  const usableAreaSqFt = Math.round(usableAreaM2 * 10.7639);
  const sourceLabel =
    analysis.source === "solar-api" ? "Live roof data" : "Modeled estimate";
  const billScale = monthlyBill / 300;
  const recommendedKw =
    analysis.systemKw > 0
      ? roundTo(
          clamp(analysis.systemKw * billScale, analysis.systemKw * 0.45, analysis.systemKw),
          1
        )
      : roundTo(monthlyBill / 24.2, 1);
  const systemScale =
    analysis.systemKw > 0 ? recommendedKw / Math.max(analysis.systemKw, 0.1) : 1;
  const annualSavings = Math.round(
    clamp(
      (analysis.annualSavingsUSD || recommendedKw * 1706 * 0.13) * billScale,
      monthlyBill * 12 * 0.18,
      monthlyBill * 12 * 0.92
    )
  );
  const twentyYearSavings = Math.round(annualSavings * 20);
  const panelAreaSqFt =
    analysis.panelWidthMeters > 0 && analysis.panelHeightMeters > 0
      ? analysis.panelWidthMeters * analysis.panelHeightMeters * 10.7639
      : 20;
  const estimatedPanels =
    analysis.panelCapacityWatts > 0
      ? Math.max(1, Math.round((recommendedKw * 1000) / analysis.panelCapacityWatts))
      : Math.max(1, Math.round(recommendedKw / 0.4));
  const installationSqFt = Math.round(
    clamp(
      estimatedPanels * panelAreaSqFt,
      Math.min(usableAreaSqFt, 120),
      Math.max(usableAreaSqFt, estimatedPanels * panelAreaSqFt)
    )
  );
  const annualKwh = Math.round(
    analysis.annualKwh > 0
      ? analysis.annualKwh * systemScale
      : recommendedKw * 1706
  );
  const carbonMetricTons = roundTo(annualKwh * 0.00039, 1);
  const carsRemoved = roundTo(carbonMetricTons / 4.6, 1);
  const treesEquivalent = roundTo(carbonMetricTons * 16.7, 1);
  const installedCost = Math.round(recommendedKw * 1000 * 2.75);
  const totalCostWithoutSolar = Math.round(
    Array.from({ length: 20 }).reduce<number>(
      (sum, _, year) => sum + monthlyBill * 12 * 1.03 ** year,
      0
    )
  );
  const upfrontAfterIncentives =
    financingMode === "buy" ? Math.round(installedCost * 0.7) : 0;
  const totalPayments =
    financingMode === "buy"
      ? upfrontAfterIncentives
      : financingMode === "lease"
        ? Math.round(Math.max(totalCostWithoutSolar - twentyYearSavings * 0.55, 0))
        : Math.round(installedCost * 1.38);
  const totalCostWithSolar = Math.max(totalCostWithoutSolar - twentyYearSavings, totalPayments);
  const totalSavings = Math.max(totalCostWithoutSolar - totalCostWithSolar, 0);

  return {
    annualKwh,
    annualSavings,
    carbonMetricTons,
    carsRemoved,
    financingRows: [
      { label: "Up-front cost of installation", value: upfrontAfterIncentives },
      { label: "Total payments over 20 years", value: totalPayments },
      { label: "Total 20-year cost with solar", value: totalCostWithSolar },
      { label: "Total 20-year cost without solar", value: totalCostWithoutSolar },
      { label: "Total 20-year savings", value: totalSavings },
    ],
    installationSqFt,
    recommendedKw,
    savingsRows: [
      { label: "Average annual savings", value: annualSavings },
      { label: "Total 20-year cost with solar", value: totalCostWithSolar },
      { label: "Total 20-year cost without solar", value: totalCostWithoutSolar },
      { label: "Total 20-year savings", value: totalSavings },
    ],
    sourceLabel,
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
