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
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  type SolarAdvisorProfile,
} from "@/lib/solar-advisor";
import {
  buildSolarMetrics,
} from "@/lib/solar-metrics";
import {
  detectArizonaUtility,
  getInverterOption,
  getPanelById,
  getPanelFit,
  getRoofShadeRiskLabel,
  getTierLabel,
  INVERTER_OPTIONS,
  SOLAR_PANELS,
  type InverterType,
  type PanelFit,
  type SolarPanel,
} from "@/lib/solarPanels";

type SolarReportDashboardProps = {
  address: string;
  analysis: RoofAnalysis;
  activePanelCount?: number;
  monthlyBill?: number;
  onActivePanelCountChange?: (panelCount: number) => void;
  onMonthlyBillChange?: (monthlyBill: number) => void;
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  onSelectedPanelIdChange?: (panelId: string) => void;
  selectedInverterType?: InverterType;
  selectedPanelId?: string;
};

type DetailTab = "overview" | "savings" | "environment" | "financing" | "next";
type FinancingMode = "buy" | "lease" | "loan";
type MetricSource = "solar-api" | "modeled" | "user-adjusted" | "illustrative" | "estimated";

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
  onSelectedInverterTypeChange,
  onSelectedPanelIdChange,
  selectedInverterType = "string",
  selectedPanelId,
}: SolarReportDashboardProps) {
  const monthlyBill = externalMonthlyBill;
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [financingMode, setFinancingMode] = useState<FinancingMode>("loan");
  const [selectedAdvisorQuestion, setSelectedAdvisorQuestion] = useState(0);
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedInverter = getInverterOption(selectedInverterType);
  const values = useMemo(
    () =>
      buildDashboardValues(
        analysis,
        monthlyBill,
        financingMode,
        activePanelCount,
        selectedPanel,
        selectedInverter.costAdderPerWatt
      ),
    [
      activePanelCount,
      analysis,
      financingMode,
      monthlyBill,
      selectedInverter.costAdderPerWatt,
      selectedPanel,
    ]
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
          <div className="mt-3 rounded-[0.95rem] border border-white/10 bg-black/22 px-3 py-2">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-white/42">
              Selected panel
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {values.selectedPanel.brand} {values.selectedPanel.model}{" "}
              {values.selectedPanel.watts}W
            </p>
          </div>
          <SuitabilityExplanationCard advisor={values.advisor} />
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
                Solar panels: {values.panelCount} of {values.maxPanelCount}
              </span>
              {values.panelCount === values.recommendedPanelCount ? (
                <span className="rounded-full bg-emerald-300/16 px-2 py-1 text-[0.56rem] font-bold uppercase tracking-[0.16em] text-emerald-100">
                  Recommended
                </span>
              ) : null}
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
          <BillComparisonCard values={values} />
        </section>

        <AiSolarAdvisorCard
          advisor={values.advisor}
          selectedQuestion={selectedAdvisorQuestion}
          onSelectQuestion={setSelectedAdvisorQuestion}
        />

        <a
          href="#contact"
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100"
        >
          Send My Full Solar Report
        </a>

        <DataProvenanceBlock />
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

        <PanelSelectorSection
          address={address}
          analysis={analysis}
          monthlyBill={monthlyBill}
          onSelectedInverterTypeChange={onSelectedInverterTypeChange}
          onSelectedPanelIdChange={onSelectedPanelIdChange}
          selectedInverterType={selectedInverterType}
          selectedPanelId={selectedPanel.id}
          values={values}
        />
      </section>
    </>
  );
}

type PanelSortKey =
  | "brand"
  | "watts"
  | "efficiency"
  | "pricePerWatt"
  | "warranty_years"
  | "paybackYears";

function PanelSelectorSection({
  address,
  analysis,
  monthlyBill,
  onSelectedInverterTypeChange,
  onSelectedPanelIdChange,
  selectedInverterType,
  selectedPanelId,
  values,
}: {
  address: string;
  analysis: RoofAnalysis;
  monthlyBill: number;
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  onSelectedPanelIdChange?: (panelId: string) => void;
  selectedInverterType: InverterType;
  selectedPanelId: string;
  values: DashboardValues;
}) {
  const [showComparison, setShowComparison] = useState(false);
  const [sortKey, setSortKey] = useState<PanelSortKey>("paybackYears");
  const selectedInverter = getInverterOption(selectedInverterType);
  const panelFits = useMemo(
    () =>
      SOLAR_PANELS.map((panel) => ({
        fit: getPanelFit(panel, {
          roofData: analysis,
          monthlyBill,
          inverterCostAdderPerWatt: selectedInverter.costAdderPerWatt,
        }),
        panel,
      })),
    [analysis, monthlyBill, selectedInverter.costAdderPerWatt]
  );
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedFit =
    panelFits.find((item) => item.panel.id === selectedPanel.id)?.fit ??
    values.selectedPanelFit;
  const utility = detectArizonaUtility(address);
  const federalCredit = selectedFit.taxCredit;
  const stateCredit = selectedFit.netCost > 0 ? 1000 : 0;
  const sortedFits = [...panelFits].sort((left, right) => {
    if (sortKey === "brand") {
      return left.panel.brand.localeCompare(right.panel.brand);
    }

    if (sortKey === "paybackYears") {
      return left.fit.paybackYears - right.fit.paybackYears;
    }

    const leftValue =
      sortKey in left.panel ? Number(left.panel[sortKey as keyof SolarPanel]) : 0;
    const rightValue =
      sortKey in right.panel ? Number(right.panel[sortKey as keyof SolarPanel]) : 0;
    return rightValue - leftValue;
  });

  return (
    <section className="mt-5 grid gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
            Panel selection
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Choose your solar panel
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
            Panel fit, cost, heat performance, and payback are recalculated for
            this roof using the selected inverter and monthly bill.
          </p>
        </div>
        <SourceBadge source="modeled" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {panelFits.map(({ fit, panel }) => (
          <PanelOptionCard
            key={panel.id}
            fit={fit}
            isSelected={panel.id === selectedPanel.id}
            onSelect={() => onSelectedPanelIdChange?.(panel.id)}
            panel={panel}
          />
        ))}
      </div>

      <InverterSelector
        selectedInverterType={selectedInverterType}
        shadeRisk={getRoofShadeRiskLabel(analysis.annualSunlightHours)}
        onSelectedInverterTypeChange={onSelectedInverterTypeChange}
      />

      <IncentivesSection
        federalCredit={federalCredit}
        stateCredit={stateCredit}
        utility={utility}
      />

      <div className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
        <button
          type="button"
          onClick={() => setShowComparison((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-white">
              Compare all panels
            </span>
            <span className="mt-1 block text-xs text-white/48">
              Sorted by payback by default.
            </span>
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            {showComparison ? "Hide" : "Show"}
          </span>
        </button>
        {showComparison ? (
          <PanelComparisonTable
            fits={sortedFits}
            onSortKeyChange={setSortKey}
            sortKey={sortKey}
          />
        ) : null}
      </div>
    </section>
  );
}

function PanelOptionCard({
  fit,
  isSelected,
  onSelect,
  panel,
}: {
  fit: PanelFit;
  isSelected: boolean;
  onSelect: () => void;
  panel: SolarPanel;
}) {
  return (
    <article
      className={`rounded-[1.1rem] border p-4 transition ${
        isSelected
          ? "border-cyan-200/42 bg-cyan-200/[0.075]"
          : "border-white/10 bg-black/18"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">{panel.brand}</p>
          <h4 className="mt-1 text-base font-semibold text-white/88">
            {panel.model}
          </h4>
          <p className="mt-1 text-xs leading-5 text-white/45">{panel.bestFor}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[0.54rem] font-bold uppercase tracking-[0.14em] text-white/68">
          {getTierLabel(panel.tier)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {fit.recommended ? (
          <span className="rounded-full bg-emerald-300/16 px-2 py-1 text-[0.56rem] font-bold uppercase tracking-[0.12em] text-emerald-100">
            Recommended for your roof
          </span>
        ) : null}
        {!fit.fits ? (
          <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[0.56rem] font-bold uppercase tracking-[0.12em] text-white/48">
            Not enough roof space
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <PanelSpec label="Wattage" value={`${panel.watts}W`} />
        <PanelSpec label="Efficiency" value={`${panel.efficiency}%`} />
        <PanelSpec label="Warranty" value={`${panel.warranty_years} yrs`} />
        <PanelSpec label="Type" value={panel.type} />
      </div>

      <div className="mt-4 rounded-[0.9rem] border border-amber-200/14 bg-amber-200/[0.06] p-3">
        <p className="text-xs font-semibold text-amber-100">
          {fit.azHeatLoss}
        </p>
        <p className="mt-1 text-xs leading-5 text-white/50">
          Temperature coefficient: {panel.tempCoefficient}% / C.
        </p>
      </div>

      <div className="mt-4 grid gap-1.5 text-xs text-white/58">
        <PanelFinancialRow label="System size" value={`${fit.systemKw.toFixed(1)} kW`} />
        <PanelFinancialRow label="Panels needed" value={`${fit.maxPanelsFit}`} />
        <PanelFinancialRow label="Total cost" value={formatMoney(fit.systemCost)} />
        <PanelFinancialRow label="After 30% tax credit" value={formatMoney(fit.netCost)} />
        <PanelFinancialRow label="Est. payback" value={`${fit.paybackYears.toFixed(1)} years`} />
        <PanelFinancialRow label="Annual savings" value={formatMoney(fit.annualSavings)} />
      </div>

      <button
        type="button"
        onClick={onSelect}
        disabled={!fit.fits}
        className={`mt-4 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition ${
          isSelected
            ? "bg-white text-slate-950"
            : "border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isSelected ? "Selected panel" : "Select this panel"}
      </button>
    </article>
  );
}

function PanelSpec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.75rem] border border-white/8 bg-black/20 p-2">
      <p className="text-[0.54rem] font-semibold uppercase tracking-[0.14em] text-white/40">
        {label}
      </p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function PanelFinancialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 py-1.5 last:border-b-0">
      <span>{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function InverterSelector({
  onSelectedInverterTypeChange,
  selectedInverterType,
  shadeRisk,
}: {
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  selectedInverterType: InverterType;
  shadeRisk: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
            Inverter option
          </p>
          <h4 className="mt-1 text-lg font-semibold text-white">
            Match electronics to roof shade
          </h4>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/72">
          Shade risk: {shadeRisk}
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {INVERTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectedInverterTypeChange?.(option.id)}
            className={`rounded-[0.95rem] border p-3 text-left transition ${
              option.id === selectedInverterType
                ? "border-cyan-200/42 bg-cyan-200/[0.075]"
                : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
            }`}
          >
            <p className="text-sm font-semibold text-white">{option.label}</p>
            <p className="mt-1 text-xs leading-5 text-white/50">{option.brands}</p>
            <p className="mt-2 text-xs font-semibold text-cyan-100">
              {option.costAdderPerWatt > 0
                ? `+$${option.costAdderPerWatt.toFixed(2)}/W`
                : "$0/W add-on"}
            </p>
            <p className="mt-1 text-xs leading-5 text-white/45">{option.bestFor}</p>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-white/50">
        Microinverters are recommended for roofs with any shading. Final
        equipment selection should be confirmed by the installer.
      </p>
    </div>
  );
}

function IncentivesSection({
  federalCredit,
  stateCredit,
  utility,
}: {
  federalCredit: number;
  stateCredit: number;
  utility: string | null;
}) {
  const totalIncentives = federalCredit + stateCredit;

  return (
    <section className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
            Available incentives
          </p>
          <h4 className="mt-1 text-lg font-semibold text-white">
            Estimated federal and Arizona savings
          </h4>
        </div>
        <span className="rounded-full border border-emerald-200/16 bg-emerald-200/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
          Up to {formatMoney(totalIncentives)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <IncentiveCard
          title="Federal ITC (30%)"
          source="IRS Form 5695"
          body={`Deduct 30% of your total system cost from federal taxes. Estimated value: ${formatMoney(federalCredit)}.`}
        />
        <IncentiveCard
          title="Arizona State Tax Credit"
          source="ARS 43-1083"
          body="Arizona offers a 25% state tax credit up to $1,000 on residential solar installations."
        />
        <IncentiveCard
          title="APS / SRP Net Metering"
          source="Utility tariff"
          body="Export excess solar electricity back to the grid for bill credits. Rate varies by utility."
        />
        {utility ? (
          <IncentiveCard
            title={`${utility} battery incentive`}
            source="Utility program"
            body="$200 rebate estimate for adding a battery storage system. Check with your utility for current availability."
          />
        ) : null}
      </div>
    </section>
  );
}

function IncentiveCard({
  body,
  source,
  title,
}: {
  body: string;
  source: string;
  title: string;
}) {
  return (
    <article className="rounded-[0.95rem] border border-white/8 bg-white/[0.035] p-3">
      <h5 className="text-sm font-semibold text-white">{title}</h5>
      <p className="mt-2 text-xs leading-5 text-white/55">{body}</p>
      <p className="mt-2 text-[0.56rem] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
        Source: {source}
      </p>
    </article>
  );
}

function PanelComparisonTable({
  fits,
  onSortKeyChange,
  sortKey,
}: {
  fits: Array<{ panel: SolarPanel; fit: PanelFit }>;
  onSortKeyChange: (key: PanelSortKey) => void;
  sortKey: PanelSortKey;
}) {
  const headers: Array<{ key: PanelSortKey; label: string }> = [
    { key: "brand", label: "Brand" },
    { key: "watts", label: "Watts" },
    { key: "efficiency", label: "Efficiency" },
    { key: "pricePerWatt", label: "$/W" },
    { key: "warranty_years", label: "Warranty" },
    { key: "paybackYears", label: "Payback" },
  ];

  return (
    <div className="mt-4 overflow-x-auto rounded-[0.9rem] border border-white/10">
      <table className="min-w-[54rem] w-full text-left text-xs">
        <thead className="bg-white/[0.05] text-white/50">
          <tr>
            {headers.map((header) => (
              <th key={header.key} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSortKeyChange(header.key)}
                  className={`font-semibold uppercase tracking-[0.14em] ${
                    sortKey === header.key ? "text-cyan-100" : ""
                  }`}
                >
                  {header.label}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-semibold uppercase tracking-[0.14em]">
              Model
            </th>
            <th className="px-3 py-2 font-semibold uppercase tracking-[0.14em]">
              AZ Heat Loss
            </th>
            <th className="px-3 py-2 font-semibold uppercase tracking-[0.14em]">
              Panels
            </th>
            <th className="px-3 py-2 font-semibold uppercase tracking-[0.14em]">
              Net Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {fits.map(({ fit, panel }) => (
            <tr key={panel.id} className="border-t border-white/8 text-white/68">
              <td className="px-3 py-2 font-semibold text-white">{panel.brand}</td>
              <td className="px-3 py-2">{panel.watts}W</td>
              <td className="px-3 py-2">{panel.efficiency}%</td>
              <td className="px-3 py-2">${panel.pricePerWatt.toFixed(2)}</td>
              <td className="px-3 py-2">{panel.warranty_years} yrs</td>
              <td className="px-3 py-2">{fit.paybackYears.toFixed(1)} yrs</td>
              <td className="px-3 py-2">{panel.model}</td>
              <td className="px-3 py-2">{fit.azHeatLoss}</td>
              <td className="px-3 py-2">{fit.maxPanelsFit}</td>
              <td className="px-3 py-2">{formatMoney(fit.netCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function BillComparisonCard({ values }: { values: DashboardValues }) {
  const currentBill = Math.max(values.monthlyBill, 1);
  const withSolar = Math.max(values.billWithSolar, 0);
  const solarPct = clamp((withSolar / currentBill) * 100, 0, 100);

  return (
    <div className="mt-4 rounded-[1rem] border border-white/10 bg-black/22 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-white/54">
          Bill after solar
        </p>
        <SourceBadge source="user-adjusted" />
      </div>
      <div className="mt-3 grid gap-2">
        <BillBar label="Current bill" tone="rose" value={currentBill} widthPct={100} />
        <BillBar label="With solar" tone="emerald" value={withSolar} widthPct={solarPct} />
      </div>
      <p className="mt-2 text-xs leading-5 text-cyan-100/74">
        Estimated savings gap: {formatMoney(values.monthlySavings)} / mo
      </p>
    </div>
  );
}

function BillBar({
  label,
  tone,
  value,
  widthPct,
}: {
  label: string;
  tone: "emerald" | "rose";
  value: number;
  widthPct: number;
}) {
  const color = tone === "emerald" ? "bg-emerald-300" : "bg-rose-300";

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-white/58">
        <span>{label}</span>
        <span className="font-semibold text-white">{formatMoney(value)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(4, widthPct)}%` }}
        />
      </div>
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
  const [downPaymentPct, setDownPaymentPct] = useState(0);
  const [loanRate, setLoanRate] = useState(6.49);
  const [loanTermYears, setLoanTermYears] = useState(20);
  const loanPrincipal = Math.max(
    values.installedCost * (1 - downPaymentPct / 100) - values.taxCredit,
    0
  );
  const monthlyLoanPayment = calculateMonthlyLoanPayment(
    loanPrincipal,
    loanRate,
    loanTermYears
  );
  const netMonthly = values.monthlySavings - monthlyLoanPayment;

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
        {financingMode === "loan" ? (
          <div className="mt-4 grid gap-3 rounded-[1rem] border border-white/10 bg-slate-950/35 p-3">
            <SliderField
              label="Down payment"
              max={30}
              min={0}
              suffix="%"
              value={downPaymentPct}
              onChange={setDownPaymentPct}
            />
            <SliderField
              label="APR"
              max={8.99}
              min={3.99}
              step={0.1}
              suffix="%"
              value={loanRate}
              onChange={setLoanRate}
            />
            <label className="grid gap-1 text-xs text-white/58">
              <span className="font-semibold uppercase tracking-[0.18em]">
                Term
              </span>
              <select
                value={loanTermYears}
                onChange={(event) => setLoanTermYears(Number(event.target.value))}
                className="rounded-full border border-white/12 bg-black/35 px-3 py-2 font-semibold text-white outline-none"
              >
                {[10, 15, 20, 25].map((term) => (
                  <option key={term} value={term} className="bg-slate-950">
                    {term} years
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-[0.9rem] border border-white/8 bg-black/24 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/56">Monthly loan payment</span>
                <span className="font-semibold text-white">
                  {formatMoney(monthlyLoanPayment)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-white/56">Monthly solar savings</span>
                <span className="font-semibold text-white">
                  {formatMoney(values.monthlySavings)}
                </span>
              </div>
              <p
                className={`mt-3 rounded-full px-3 py-2 text-center text-xs font-semibold ${
                  netMonthly >= 0
                    ? "bg-emerald-300/14 text-emerald-100"
                    : "bg-amber-300/14 text-amber-100"
                }`}
              >
                {netMonthly >= 0
                  ? `Day 1 savings: ${formatMoney(netMonthly)} / mo`
                  : `Breakeven gap: ${formatMoney(Math.abs(netMonthly))} / mo`}
              </p>
            </div>
          </div>
        ) : null}
        <div className="mt-4 grid gap-2">
          {financingMode === "buy" ? (
            <>
              <MiniReadout label="System cost" source="illustrative" value={formatMoney(values.installedCost)} />
              <MiniReadout label="Federal tax credit" source="illustrative" value={formatMoney(values.taxCredit)} />
              <MiniReadout label="Net cost after credit" source="illustrative" value={formatMoney(values.netCostAfterCredit)} />
              <MiniReadout label="Payback" source="modeled" value={`${values.paybackYears.toFixed(1)} years`} />
            </>
          ) : null}
          {financingMode === "lease" ? (
            <>
              <MiniReadout label="$0 down" source="illustrative" value="$0" />
              <MiniReadout label="Monthly lease estimate" source="illustrative" value={formatMoney(values.leaseMonthlyEstimate)} />
              <MiniReadout label="Monthly bill savings" source="user-adjusted" value={formatMoney(values.monthlySavings)} />
            </>
          ) : null}
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

function SliderField({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix: string;
  value: number;
}) {
  return (
    <label className="block text-xs text-white/58">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold uppercase tracking-[0.18em]">{label}</span>
        <span className="font-semibold text-white">
          {value.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-cyan-300"
      />
    </label>
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

function SuitabilityExplanationCard({
  advisor,
}: {
  advisor: SolarAdvisorProfile;
}) {
  return (
    <div className="mt-4 rounded-[1.05rem] border border-white/10 bg-black/24 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-white/48">
          {advisor.suitability.headline}
        </p>
        <span className="rounded-full border border-cyan-200/18 bg-cyan-200/10 px-2.5 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-cyan-100">
          {advisor.candidateLabel} candidate
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {advisor.suitability.positiveFactors.slice(0, 3).map((factor) => (
          <div key={factor} className="flex gap-2 text-xs leading-5 text-white/66">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
            <span>{factor}</span>
          </div>
        ))}
        {advisor.suitability.limitingFactors.slice(0, 2).map((factor) => (
          <div key={factor} className="flex gap-2 text-xs leading-5 text-amber-100/80">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
            <span>{factor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiSolarAdvisorCard({
  advisor,
  onSelectQuestion,
  selectedQuestion,
}: {
  advisor: SolarAdvisorProfile;
  onSelectQuestion: (index: number) => void;
  selectedQuestion: number;
}) {
  const activeQuestion =
    advisor.questions[selectedQuestion] ?? advisor.questions[0];

  return (
    <section className="rounded-[1.15rem] border border-white/12 bg-slate-950/68 p-4 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
            AI Solar Advisor
          </p>
          <h3 className="mt-2 text-base font-semibold text-white">
            Plain-English roof guidance
          </h3>
        </div>
        <SourceBadge source="estimated" />
      </div>
      <p className="mt-3 text-sm leading-6 text-white/64">
        {advisor.summary}
      </p>
      <div className="mt-3 rounded-[0.9rem] border border-white/10 bg-black/22 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/44">
            Estimated sunlight quality
          </p>
          <span className="rounded-full border border-emerald-200/18 bg-emerald-200/10 px-2.5 py-1 text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-emerald-100">
            {advisor.sunlightQuality.label} / {advisor.sunlightQuality.score}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-white/52">
          {advisor.sunlightQuality.summary}
        </p>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {advisor.questions.map((item, index) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onSelectQuestion(index)}
            className={`shrink-0 rounded-full px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em] transition ${
              index === selectedQuestion
                ? "bg-white text-slate-950"
                : "border border-white/10 bg-black/20 text-white/58 hover:text-white"
            }`}
          >
            {item.question}
          </button>
        ))}
      </div>
      {activeQuestion ? (
        <div className="mt-3 rounded-[0.95rem] border border-cyan-200/12 bg-cyan-200/[0.055] p-3">
          <p className="text-sm font-semibold text-white">
            {activeQuestion.question}
          </p>
          <p className="mt-2 text-xs leading-5 text-white/62">
            {activeQuestion.answer}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SourceBadge({ source }: { source: MetricSource }) {
  const styles: Record<MetricSource, string> = {
    "solar-api": "border-cyan-200/18 bg-cyan-200/10 text-cyan-100",
    modeled: "border-amber-200/18 bg-amber-200/10 text-amber-100",
    "user-adjusted": "border-emerald-200/18 bg-emerald-200/10 text-emerald-100",
    illustrative: "border-slate-200/18 bg-white/8 text-slate-200",
    estimated: "border-fuchsia-200/18 bg-fuchsia-200/10 text-fuchsia-100",
  };
  const labels: Record<MetricSource, string> = {
    "solar-api": "Solar API",
    modeled: "Modeled",
    "user-adjusted": "User-adjusted",
    illustrative: "Illustrative",
    estimated: "Estimated",
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
  activePanelCount?: number,
  selectedPanel: SolarPanel = getPanelById(),
  inverterCostAdderPerWatt = 0
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
  const selectedPanelFit = getPanelFit(selectedPanel, {
    roofData: analysis,
    monthlyBill,
    selectedPanelCount: panelCount,
    inverterCostAdderPerWatt,
  });
  const panelAdjustedMetrics = {
    ...metrics,
    annualKwh: selectedPanelFit.annualKwh,
    annualSavings: selectedPanelFit.annualSavings,
    monthlySavings: Math.round(selectedPanelFit.annualSavings / 12),
    panelCount: selectedPanelFit.maxPanelsFit,
    paybackYears: selectedPanelFit.paybackYears,
    systemKw: selectedPanelFit.systemKw,
  };
  const advisor = buildSolarAdvisorProfile(
    buildSolarAdvisorInputFromAnalysis(
      {
        ...analysis,
        annualKwh: selectedPanelFit.annualKwh,
        annualSavingsUSD: selectedPanelFit.annualSavings,
        panelCapacityWatts: selectedPanel.watts,
        panelCount: selectedPanelFit.maxPanelsFit,
        systemKw: selectedPanelFit.systemKw,
      },
      panelAdjustedMetrics,
      monthlyBill
    )
  );
  const usableAreaSqFt = Math.round(metrics.usableRoofAreaM2 * 10.7639);
  const rejectedPanelCandidateCount = metrics.rejectedCandidateCount;
  const annualKwh = selectedPanelFit.annualKwh;
  const recommendedKw = selectedPanelFit.systemKw;
  const annualSavings = selectedPanelFit.annualSavings;
  const monthlySavings = Math.round(selectedPanelFit.annualSavings / 12);
  const billWithSolar = Math.max(monthlyBill - monthlySavings, 0);
  const recommendedPanelCount = findRecommendedPanelCount(analysis, monthlyBill, maxPanelCount);
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
  const installedCost = selectedPanelFit.systemCost;
  const taxCredit = selectedPanelFit.taxCredit;
  const netCostAfterCredit = selectedPanelFit.netCost;
  const leaseMonthlyEstimate = Math.round((recommendedKw * 1000 * 8) / 12);
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
    advisor,
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
      {
        label: "Installed cost basis",
        value: `$${(selectedPanel.pricePerWatt + inverterCostAdderPerWatt).toFixed(2)}/W`,
      },
      { label: "Utility escalation", value: `${Math.round(utilityEscalationRate * 100)}% / yr` },
      { label: "Buy incentive placeholder", value: `${Math.round(buyIncentiveRate * 100)}%` },
      { label: "Loan payment multiplier", value: `${loanPaymentMultiplier.toFixed(2)}x installed cost` },
    ],
    installationSqFt,
    installedCost,
    leaseMonthlyEstimate,
    maxPanelCount,
    monthlyBill,
    monthlySavings,
    billWithSolar,
    netCostAfterCredit,
    panelCount,
    paybackYears: selectedPanelFit.paybackYears,
    recommendedKw,
    recommendedPanelCount,
    rejectedPanelCandidateCount,
    selectedPanelFit,
    selectedPanel,
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
    taxCredit,
    upfrontAfterIncentives,
    usableAreaSqFt,
  };
}

function findRecommendedPanelCount(
  analysis: RoofAnalysis,
  monthlyBill: number,
  maxPanelCount: number
) {
  const annualBill = Math.max(monthlyBill * 12, 1);

  for (let panelCount = 1; panelCount <= maxPanelCount; panelCount += 1) {
    const metrics = buildSolarMetrics(analysis, {
      monthlyBill,
      selectedPanelCount: panelCount,
    });

    if (metrics.annualSavings >= annualBill) {
      return panelCount;
    }
  }

  return maxPanelCount;
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

function calculateMonthlyLoanPayment(
  principal: number,
  annualRatePct: number,
  termYears: number
) {
  if (principal <= 0) {
    return 0;
  }

  const monthlyRate = annualRatePct / 100 / 12;
  const payments = termYears * 12;

  if (monthlyRate <= 0) {
    return Math.round(principal / payments);
  }

  return Math.round(
    (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -payments)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
