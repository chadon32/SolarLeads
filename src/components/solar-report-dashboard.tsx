"use client";

import {
  Banknote,
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
import {
  getUsableAreaM2,
  type RoofAnalysis,
} from "@/lib/roof-analysis";

type SolarReportDashboardProps = {
  address: string;
  analysis: RoofAnalysis;
};

type FinancingMode = "buy" | "lease" | "loan";

const monthlyBillOptions = [100, 150, 200, 250, 300, 350, 400, 450, 500];

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
  const [financingMode, setFinancingMode] = useState<FinancingMode>("loan");
  const values = useMemo(
    () => buildDashboardValues(analysis, monthlyBill, financingMode),
    [analysis, financingMode, monthlyBill]
  );

  return (
    <section
      id="report-dashboard"
      className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-7 md:px-10 lg:px-12"
    >
      <div className="mx-auto max-w-4xl text-center">
        <span className="liquid-glass inline-flex rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
          Solar estimate report
        </span>
        <h2
          className="mt-5 text-4xl leading-[0.95] text-white md:text-6xl"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          Your Arizona Solar AI report is ready.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/62">
          {address}
        </p>
      </div>

      <div className="mt-8 grid gap-5">
        <RoofAnalysisSummary values={values} />
        <EstimateTuner
          monthlyBill={monthlyBill}
          onMonthlyBillChange={setMonthlyBill}
          values={values}
        />
        <EnvironmentalImpact values={values} />
        <FinancingEstimate
          financingMode={financingMode}
          onFinancingModeChange={setFinancingMode}
          values={values}
        />
        <ReportCTA />
      </div>
    </section>
  );
}

function RoofAnalysisSummary({ values }: { values: DashboardValues }) {
  return (
    <article className="liquid-glass rounded-[2rem] p-5 shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
            Roof analysis status
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-white">
            Analysis complete. Your roof has:
          </h3>
        </div>
        <span className="w-fit rounded-full border border-emerald-200/15 bg-emerald-200/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100">
          {values.sourceLabel}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <ResultCard
          icon={Sun}
          tone="sun"
          value={`${values.sunlightHours.toLocaleString()} hours of usable sunlight per year`}
          detail="Based on day-to-day analysis of weather patterns."
        />
        <ResultCard
          icon={Grid3X3}
          tone="cyan"
          value={`${formatNumber(values.usableAreaSqFt)} sq ft available for solar panels`}
          detail="Based on roof layout, estimated shade, and usable panel placement."
        />
        <ResultCard
          icon={TrendingUp}
          tone="sun"
          value={`${formatMoney(values.twentyYearSavings)} savings`}
          detail="Estimated net savings for your roof over 20 years."
        />
      </div>
    </article>
  );
}

function EstimateTuner({
  monthlyBill,
  onMonthlyBillChange,
  values,
}: {
  monthlyBill: number;
  onMonthlyBillChange: (value: number) => void;
  values: DashboardValues;
}) {
  return (
    <section className="grid gap-5">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
          Fine-tune your estimate
        </p>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Fine-tune your information to see how much you could save.
        </h3>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <article className="liquid-glass rounded-[2rem] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
          Bill profile
        </p>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Your average monthly electric bill
        </h3>
        <p className="mt-3 text-sm leading-7 text-white/62">
          We use your bill to estimate how much electricity you use based on
          typical utility rates in your area.
        </p>

        <label className="mt-6 block text-sm font-semibold text-white/72">
          Monthly bill
        </label>
        <select
          value={monthlyBill}
          onChange={(event) => onMonthlyBillChange(Number(event.target.value))}
          className="mt-3 w-full rounded-full border border-white/12 bg-black/35 px-5 py-4 text-lg font-semibold text-white outline-none transition focus:border-cyan-200/50"
        >
          {monthlyBillOptions.map((value) => (
            <option key={value} value={value} className="bg-slate-950">
              {formatMoney(value)}
            </option>
          ))}
        </select>
        <p className="mt-4 text-xs leading-6 text-white/45">
          Local display estimate. Your final report can refine this with your
          exact utility history.
        </p>
        </article>

        <article className="liquid-glass rounded-[2rem] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
          Recommended system
        </p>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Your recommended solar installation size
        </h3>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <MetricTile
            icon={Zap}
            label="System size"
            value={`${values.recommendedKw.toFixed(1)} kW`}
          />
          <MetricTile
            icon={Grid3X3}
            label="Panel footprint"
            value={`${formatNumber(values.installationSqFt)} sq ft`}
          />
        </div>
        <p className="mt-5 text-sm leading-7 text-white/62">
          This size is estimated to cover most of your electricity usage based
          on your roof and bill profile.
        </p>
        </article>
      </div>
    </section>
  );
}

function EnvironmentalImpact({ values }: { values: DashboardValues }) {
  return (
    <article className="liquid-glass rounded-[2rem] p-5 shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-7">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
          Environmental impact
        </p>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Your potential environmental impact
        </h3>
        <p className="mt-3 text-sm leading-7 text-white/62">
          Estimated annual environmental impact of the recommended solar
          installation size.
        </p>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <MetricTile
          icon={Leaf}
          label="Carbon dioxide avoided"
          value={`${values.carbonMetricTons.toFixed(1)} metric tons`}
          tone="gold"
        />
        <MetricTile
          icon={Car}
          label="Passenger cars removed"
          value={`${values.carsRemoved.toFixed(1)} cars for 1 year`}
        />
        <MetricTile
          icon={TreePine}
          label="Trees planted equivalent"
          value={`${values.treesEquivalent.toFixed(1)} trees for 10 years`}
          tone="gold"
        />
      </div>
    </article>
  );
}

function FinancingEstimate({
  financingMode,
  onFinancingModeChange,
  values,
}: {
  financingMode: FinancingMode;
  onFinancingModeChange: (value: FinancingMode) => void;
  values: DashboardValues;
}) {
  return (
    <article className="liquid-glass rounded-[2rem] p-5 shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/82">
            Financing estimate
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-white">
            Learn how to finance your solar panels
          </h3>
          <p className="mt-3 text-sm leading-7 text-white/62">
            {financingCopy[financingMode]}
          </p>
        </div>
        <div className="grid grid-cols-3 rounded-full border border-white/10 bg-black/24 p-1">
          {(["buy", "lease", "loan"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFinancingModeChange(mode)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                financingMode === mode
                  ? "bg-white text-slate-950"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {mode === "lease" ? "Lease / PPA" : mode}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        <MetricTile
          icon={Banknote}
          label="Upfront cost after incentives"
          value={formatMoney(values.upfrontAfterIncentives)}
        />
        <MetricTile
          icon={DollarSign}
          label="Average annual savings"
          value={formatMoney(values.annualSavings)}
          tone="gold"
        />
        <MetricTile
          icon={TrendingUp}
          label="Total 20-year savings"
          value={formatMoney(values.twentyYearSavings)}
          tone="gold"
        />
      </div>

      <div className="mt-7 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/20">
        {values.financingRows.map((row) => (
          <div
            key={row.label}
            className="grid gap-2 border-b border-white/8 px-4 py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <span className="text-sm text-white/62">{row.label}</span>
            <span className="text-lg font-semibold text-white">
              {formatMoney(row.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-6 text-white/45">
        Estimated ranges only. Financing terms, incentives, utility rates, and
        final provider pricing can change the actual total.
      </p>
    </article>
  );
}

function ReportCTA() {
  return (
    <article className="liquid-glass rounded-[2rem] p-6 text-center shadow-[0_28px_95px_rgba(0,0,0,0.42)] sm:p-8">
      <h3
        className="text-4xl leading-none text-white md:text-5xl"
        style={{ fontFamily: "'Instrument Serif', serif" }}
      >
        Ready to get started?
      </h3>
      <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/62">
        Review your solar report, compare your options, and connect with a
        solar provider when you are ready.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="#contact"
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100 sm:w-auto"
        >
          Get My Free Estimate
        </a>
        <a
          href="#how-it-works"
          className="liquid-glass inline-flex w-full items-center justify-center rounded-full px-6 py-4 text-sm font-semibold text-white/86 transition hover:-translate-y-0.5 hover:text-white sm:w-auto"
        >
          Learn About Going Solar
        </a>
        <a
          href="#reviews"
          className="text-sm font-semibold text-cyan-100/82 transition hover:text-cyan-50"
        >
          How to Choose a Provider
        </a>
      </div>
    </article>
  );
}

function ResultCard({
  icon: Icon,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  value: string;
  detail: string;
  tone: "cyan" | "sun";
}) {
  const toneClass =
    tone === "sun"
      ? "bg-amber-200/12 text-amber-100"
      : "bg-cyan-200/12 text-cyan-100";

  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
      <span className={`grid h-11 w-11 place-items-center rounded-full ${toneClass}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-5 text-xl font-semibold leading-7 text-white">{value}</p>
      <p className="mt-3 text-sm leading-6 text-white/56">{detail}</p>
    </div>
  );
}

function MetricTile({
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
    <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${accent}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
          {label}
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold text-white">{value}</p>
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
      ? roundTo(clamp(analysis.systemKw * billScale, analysis.systemKw * 0.45, analysis.systemKw), 1)
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
    sourceLabel,
    sunlightHours: analysis.annualSunlightHours,
    totalCostWithoutSolar,
    totalCostWithSolar,
    totalPayments,
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
