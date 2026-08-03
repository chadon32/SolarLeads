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
import { type ReactNode, useMemo, useState } from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import {
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  type SolarAdvisorProfile,
} from "@/lib/solar-advisor";
import {
  ARIZONA_AVG_RATE_PER_KWH,
} from "@/lib/solar-metrics";
import { ARIZONA_INSTALLED_COST_MARKET } from "@/lib/solar-assumptions";
import { buildActiveSolarEstimate } from "@/lib/active-solar-estimate";
import {
  BATTERY_OPTIONS,
  getBatteryById,
  type BatteryOption,
} from "@/lib/batteries";
import {
  calculateArizonaStateSolarCredit,
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
  getFederalResidentialSolarCreditRate,
} from "@/lib/financial-model";
import {
  detectArizonaUtility,
  getInverterOption,
  getPanelAreaM2,
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
  activeTab?: DetailTab;
  address: string;
  analysis: RoofAnalysis;
  activePanelCount?: number;
  monthlyBill?: number;
  onActivePanelCountChange?: (panelCount: number) => void;
  onMonthlyBillChange?: (monthlyBill: number) => void;
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  onSelectedPanelIdChange?: (panelId: string) => void;
  onAddBatteryChange?: (addBattery: boolean) => void;
  onBatteryOptionChange?: (batteryOption: string) => void;
  onTabChange?: (tab: DetailTab) => void;
  addBattery?: boolean;
  batteryOption?: string;
  selectedInverterType?: InverterType;
  selectedPanelId?: string;
  sendReportContent?: ReactNode;
};

export type DetailTab = "overview" | "roof" | "panels" | "savings" | "financing" | "send";
type FinancingMode = "buy" | "lease" | "loan";
type MetricSource =
  | "solar-api"
  | "manufacturer"
  | "modeled"
  | "user-adjusted"
  | "illustrative"
  | "estimated";

const monthlyBillOptions = [100, 150, 200, 250, 300, 350, 400, 450, 500];

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "roof", label: "Roof & Shade" },
  { id: "panels", label: "Panels" },
  { id: "savings", label: "Savings" },
  { id: "financing", label: "Financing" },
  { id: "send", label: "Send Report" },
];

const financingCopy: Record<FinancingMode, string> = {
  buy:
    "Pay for the system up front and keep the long-term savings. Buying can work well for homeowners who want the cleanest path to ownership.",
  lease:
    "Use solar with a third-party owner handling system costs. A lease or PPA may reduce upfront cost, though long-term savings can be lower.",
  loan:
    "Own your system and pay over time. Loan pricing, approval, fees, and final terms depend on the lender and installer.",
};

export function SolarReportDashboard({
  activeTab: externalActiveTab,
  activePanelCount,
  address,
  analysis,
  monthlyBill: externalMonthlyBill = 200,
  onActivePanelCountChange,
  onAddBatteryChange,
  onBatteryOptionChange,
  onMonthlyBillChange,
  onSelectedInverterTypeChange,
  onSelectedPanelIdChange,
  onTabChange,
  addBattery = false,
  batteryOption,
  selectedInverterType = "string",
  selectedPanelId,
  sendReportContent,
}: SolarReportDashboardProps) {
  const monthlyBill = externalMonthlyBill;
  const [internalActiveTab, setInternalActiveTab] = useState<DetailTab>("overview");
  const [financingMode, setFinancingMode] = useState<FinancingMode>("loan");
  const [selectedAdvisorQuestion, setSelectedAdvisorQuestion] = useState(0);
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedInverter = getInverterOption(selectedInverterType);
  const selectedBattery = addBattery ? getBatteryById(batteryOption) : null;
  const activeTab = externalActiveTab ?? internalActiveTab;
  const values = useMemo(
    () =>
      buildDashboardValues(
        analysis,
        monthlyBill,
        financingMode,
        activePanelCount,
        selectedPanel,
        selectedInverter.costAdderPerWatt,
        selectedBattery
      ),
    [
      activePanelCount,
      analysis,
      financingMode,
      monthlyBill,
      selectedInverter.costAdderPerWatt,
      selectedBattery,
      selectedPanel,
    ]
  );

  const updateMonthlyBill = (value: number) => {
    onMonthlyBillChange?.(value);
  };
  const setActiveTab = (tab: DetailTab) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };
  const openSendReport = () => {
    setActiveTab("send");
    window.requestAnimationFrame(() => {
      document
        .getElementById("report-dashboard")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <>
      <aside className="min-w-0 space-y-3 lg:col-span-5">
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
          <p className="mt-3 text-sm leading-6 text-white/62">
            Estimated solar layout generated from available roof and sunlight data.
            Final panel placement, incentives, pricing, and savings require installer confirmation.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniReadout label="Solar readiness" source="solar-api" value={`${values.advisor.suitability.score}/100`} />
            <MiniReadout label="Panels" source="solar-api" value={`${values.panelCount}`} />
            <MiniReadout label="Annual savings" source="user-adjusted" value={formatMoney(values.annualSavings)} />
            <MiniReadout label="System size" source="user-adjusted" value={`${values.recommendedKw.toFixed(1)} kW`} />
          </div>
          <SuitabilityExplanationCard advisor={values.advisor} />
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
              className="mt-2 h-11 w-full cursor-pointer accent-cyan-300"
            />
          </label>
          {values.excludedCandidateCount > 0 ? (
            <p className="mt-2 text-xs leading-5 text-amber-100/85">
              {values.excludedCandidateCount} raw Solar API positions were removed before
              the preliminary ceiling because of spacing, overlap, or estimated setbacks.
            </p>
          ) : null}
          {values.remainingPanelCapacity > 0 ? (
            <p className="mt-2 text-xs leading-5 text-white/58">
              The selected {values.panelCount}-panel layout leaves {values.remainingPanelCapacity}{" "}
              positions available below the preliminary ceiling.
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-white/46">
            Panels are placed from available roof candidate points and adjusted for spacing,
            setbacks, and overlap prevention.
          </p>
          <select
            value={monthlyBill}
            onChange={(event) => updateMonthlyBill(Number(event.target.value))}
            aria-label="Monthly electric bill"
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

        <DataProvenanceBlock />
      </aside>

      <section
        id="report-dashboard"
        className="w-full min-w-0 max-w-full rounded-[1.5rem] border border-white/12 bg-slate-950/70 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-4 lg:col-span-12"
      >
        <div
          role="tablist"
          aria-label="Solar report detail sections"
          className="grid grid-cols-3 gap-1 rounded-[1.15rem] border border-white/10 bg-black/28 p-1 xl:grid-cols-6 xl:rounded-full"
        >
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              id={`report-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              aria-controls="report-tabpanel"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-11 rounded-full px-2 py-2 text-[0.68rem] font-semibold uppercase leading-4 tracking-[0.05em] transition xl:px-4 xl:py-3 xl:text-xs xl:tracking-[0.14em] ${
                activeTab === tab.id
                  ? "bg-white text-slate-950"
                  : "text-white/58 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="report-tabpanel"
          role="tabpanel"
          aria-labelledby={`report-tab-${activeTab}`}
          className="mt-4"
        >
          {activeTab === "overview" ? (
            <ReportOverviewTab
              onSendReport={openSendReport}
              values={values}
            />
          ) : null}
          {activeTab === "roof" ? (
            <RoofShadeTab
              advisor={values.advisor}
              analysis={analysis}
              values={values}
            />
          ) : null}
          {activeTab === "panels" ? (
            <PanelsTab
              address={address}
              analysis={analysis}
              monthlyBill={monthlyBill}
              onSelectedInverterTypeChange={onSelectedInverterTypeChange}
              onSelectedPanelIdChange={onSelectedPanelIdChange}
              onAddBatteryChange={onAddBatteryChange}
              onBatteryOptionChange={onBatteryOptionChange}
              addBattery={addBattery}
              batteryOption={batteryOption}
              selectedInverterType={selectedInverterType}
              selectedPanelId={selectedPanel.id}
              values={values}
            />
          ) : null}
          {activeTab === "savings" ? (
            <SavingsTab
              onMonthlyBillChange={updateMonthlyBill}
              values={values}
            />
          ) : null}
          {activeTab === "financing" ? (
            <FinancingTab
              financingMode={financingMode}
              onFinancingModeChange={setFinancingMode}
              values={values}
            />
          ) : null}
          {activeTab === "send" ? (
            <SendReportTab sendReportContent={sendReportContent} />
          ) : null}
        </div>
      </section>
    </>
  );
}

type PanelSortKey =
  | "brand"
  | "model"
  | "watts"
  | "efficiency"
  | "installedCostPerWatt"
  | "warranty_years"
  | "azHeatLoss"
  | "netCost"
  | "paybackYears";

function PanelsTab({
  addBattery,
  address,
  analysis,
  batteryOption,
  monthlyBill,
  onAddBatteryChange,
  onBatteryOptionChange,
  onSelectedInverterTypeChange,
  onSelectedPanelIdChange,
  selectedInverterType,
  selectedPanelId,
  values,
}: {
  addBattery: boolean;
  address: string;
  analysis: RoofAnalysis;
  batteryOption?: string;
  monthlyBill: number;
  onAddBatteryChange?: (addBattery: boolean) => void;
  onBatteryOptionChange?: (batteryOption: string) => void;
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  onSelectedPanelIdChange?: (panelId: string) => void;
  selectedInverterType: InverterType;
  selectedPanelId: string;
  values: DashboardValues;
}) {
  const [showComparison, setShowComparison] = useState(true);
  const [sortKey, setSortKey] = useState<PanelSortKey>("paybackYears");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const selectedInverter = getInverterOption(selectedInverterType);

  const panelFitsById = useMemo(
    () =>
      SOLAR_PANELS.reduce<Record<string, PanelFit>>((fits, panel) => {
        fits[panel.id] = getPanelFit(panel, {
          roofData: analysis,
          monthlyBill,
          selectedPanelCount: values.panelCount,
          inverterCostAdderPerWatt: selectedInverter.costAdderPerWatt,
        });
        return fits;
      }, {}),
    [analysis, monthlyBill, selectedInverter.costAdderPerWatt, values.panelCount]
  );

  const panelFits = useMemo(
    () =>
      SOLAR_PANELS.map((panel) => ({
        fit: panelFitsById[panel.id],
        panel,
      })).filter((item): item is { panel: SolarPanel; fit: PanelFit } => Boolean(item.fit)),
    [panelFitsById]
  );
  const selectedPanel = getPanelById(selectedPanelId);
  const selectedBattery = addBattery ? getBatteryById(batteryOption) : null;
  const selectedFit = values.selectedPanelFit;
  const utility = detectArizonaUtility(address);
  const federalCredit = calculateFederalResidentialSolarCredit(
    selectedFit.systemCost + (selectedBattery?.cost ?? 0)
  );
  const stateCredit = calculateArizonaStateSolarCredit(selectedFit.systemCost);
  const sortedFits = [...panelFits].sort((left, right) => {
    const direction = sortDirection === "asc" ? 1 : -1;

    if (sortKey === "brand") {
      return left.panel.brand.localeCompare(right.panel.brand) * direction;
    }

    if (sortKey === "model") {
      return left.panel.model.localeCompare(right.panel.model) * direction;
    }

    if (sortKey === "paybackYears") {
      return (left.fit.paybackYears - right.fit.paybackYears) * direction;
    }

    if (sortKey === "netCost") {
      return (left.fit.netCost - right.fit.netCost) * direction;
    }

    if (sortKey === "azHeatLoss") {
      return (
        Number.parseFloat(left.fit.azHeatLoss) -
        Number.parseFloat(right.fit.azHeatLoss)
      ) * direction;
    }

    const leftValue =
      sortKey in left.panel ? Number(left.panel[sortKey as keyof SolarPanel]) : 0;
    const rightValue =
      sortKey in right.panel ? Number(right.panel[sortKey as keyof SolarPanel]) : 0;
    return (rightValue - leftValue) * direction;
  });

  const bestAlternatives = sortedFits
    .filter(({ panel }) => panel.id !== selectedPanel.id)
    .slice(0, 3);

  return (
    <section id="panel-selection" className="grid gap-4 scroll-mt-24">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/82">
            Panel selection
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
            Recommended panel for this roof
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
            We show the current panel first, then a few alternatives. Open the
            comparison table only if you want the full equipment catalog.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/48">
            Manufacturer specifications are model-specific. Installed costs use
            the Arizona market average of ${ARIZONA_INSTALLED_COST_MARKET.averagePerWatt.toFixed(2)}/W
            as of {ARIZONA_INSTALLED_COST_MARKET.asOf}; actual equipment pricing,
            availability, labor, and financing require an installer quote.
          </p>
        </div>
        <SourceBadge source="modeled" />
      </div>

      {panelFits.length ? (
        <div className="grid items-stretch gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelOptionCard
            fit={selectedFit}
            isSelected
            onSelect={() => undefined}
            panel={selectedPanel}
            variant="featured"
          />
          <div className="grid gap-3">
            <div className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
              <p className="text-sm font-semibold text-white">Why this panel?</p>
              <p className="mt-2 text-sm leading-6 text-white/58">
                {selectedPanel.brand} {selectedPanel.model} balances output,
                roof fit, Arizona heat performance, and modeled payback for the
                current monthly bill.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MiniReadout label="Wattage" source="manufacturer" value={`${selectedPanel.watts}W`} />
                <MiniReadout label="Efficiency" source="manufacturer" value={`${selectedPanel.efficiency}%`} />
                <MiniReadout label="Product warranty" source="manufacturer" value={`${selectedPanel.warranty_years} yrs`} />
                <MiniReadout label="Modeled payback" source="modeled" value={`${selectedFit.paybackYears.toFixed(1)} yrs`} />
              </div>
            </div>
            {bestAlternatives.map(({ fit, panel }) => (
              <PanelOptionCard
                key={panel.id}
                fit={fit}
                isSelected={false}
                onSelect={() => {
                  onSelectedPanelIdChange?.(panel.id);
                  window.requestAnimationFrame(() => {
                    document
                      .getElementById("solar-workspace")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  });
                }}
                panel={panel}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PanelOptionSkeleton key={index} />
          ))}
        </div>
      )}

      <InverterSelector
        annualSunlightHours={analysis.annualSunlightHours}
        selectedInverterType={selectedInverterType}
        shadeRisk={getRoofShadeRiskLabel(analysis.annualSunlightHours)}
        onSelectedInverterTypeChange={onSelectedInverterTypeChange}
      />

      <BatteryStorageSection
        addBattery={addBattery}
        batteryOption={batteryOption}
        onAddBatteryChange={onAddBatteryChange}
        onBatteryOptionChange={onBatteryOptionChange}
      />

      <IncentivesSection
        federalCredit={federalCredit}
        stateCredit={stateCredit}
        utility={utility}
      />

      <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-black/18 p-4">
        <button
          type="button"
          onClick={() => setShowComparison((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-white">
              {showComparison ? "Hide comparison" : "Compare all panels"}
            </span>
            <span className="mt-1 block text-xs text-white/62">
              Sorted by payback by default.
            </span>
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            {showComparison ? "Hide" : "Show"}
          </span>
        </button>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ${
            showComparison ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <PanelComparisonTable
              fits={sortedFits}
              onSortKeyChange={(nextKey) => {
                if (nextKey === sortKey) {
                  setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
                } else {
                  setSortKey(nextKey);
                  setSortDirection("asc");
                }
              }}
              selectedPanelId={selectedPanel.id}
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelOptionCard({
  fit,
  isSelected,
  onSelect,
  panel,
  variant = "compact",
}: {
  fit: PanelFit;
  isSelected: boolean;
  onSelect: () => void;
  panel: SolarPanel;
  variant?: "compact" | "featured";
}) {
  const isFeatured = variant === "featured";

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[1.1rem] border p-4 transition ${
        isSelected
          ? "border-cyan-200/70 bg-cyan-200/[0.09] shadow-[0_0_0_1px_rgba(103,232,249,0.18),0_18px_50px_rgba(34,211,238,0.12)]"
          : "border-white/10 bg-black/18"
      } ${isFeatured ? "min-h-[25rem]" : "min-h-[18rem]"}`}
    >
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
        {isSelected ? (
          <span className="rounded-full bg-cyan-200 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] text-slate-950">
            Selected
          </span>
        ) : null}
        {fit.recommended ? (
          <span className="rounded-full bg-emerald-300 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] text-slate-950">
            Recommended
          </span>
        ) : null}
        {!fit.fits ? (
          <span className="rounded-full bg-slate-500/70 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] text-white">
            Roof too small
          </span>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-3 pr-24">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{panel.brand}</p>
          <h4 className="mt-1 line-clamp-2 text-base font-semibold text-white/88">
            {panel.model}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/58">{panel.bestFor}</p>
          <a
            href={panel.specSourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex text-[0.68rem] font-medium text-cyan-100/70 underline decoration-cyan-100/25 underline-offset-2 hover:text-cyan-100"
          >
            Manufacturer specifications
          </a>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] ${getTierBadgeClass(panel.tier)}`}>
          {getTierLabel(panel.tier)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <PanelSpec label="Wattage" value={`${panel.watts}W`} />
        <PanelSpec label="Efficiency" value={`${panel.efficiency}%`} />
        <PanelSpec label="Warranty" value={`${panel.warranty_years} yrs`} />
        <PanelSpec label="Type" value={panel.type} />
      </div>

      {isFeatured ? (
      <div className="mt-4 rounded-[0.9rem] border border-amber-200/14 bg-amber-200/[0.06] p-3">
        <p className="text-xs font-semibold text-amber-100">
          {fit.azHeatLoss}
        </p>
        <p className="mt-1 text-xs leading-5 text-white/50">
          Temperature coefficient: {panel.tempCoefficient}% / C.
        </p>
      </div>
      ) : null}

      <div className="mt-auto grid gap-1.5 pt-4 text-xs text-white/58">
        <PanelFinancialRow label="System size" value={`${fit.systemKw.toFixed(1)} kW`} />
        <PanelFinancialRow label="Current layout" value={`${fit.maxPanelsFit} panels`} />
        {isFeatured ? (
          <PanelFinancialRow label="Total cost" value={formatMoney(fit.systemCost)} />
        ) : null}
        <PanelFinancialRow label="Estimated net cost" value={formatMoney(fit.netCost)} />
        <PanelFinancialRow label="Est. payback" value={`${fit.paybackYears.toFixed(1)} years`} />
        <PanelFinancialRow label="Annual savings" value={formatMoney(fit.annualSavings)} />
      </div>

      <button
        type="button"
        onClick={onSelect}
        disabled={!fit.fits}
        className={`mt-4 min-h-11 w-full rounded-full px-4 py-3 text-sm font-semibold transition ${
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

function PanelOptionSkeleton() {
  return (
    <div className="min-h-[18rem] animate-pulse rounded-[1.1rem] border border-white/10 bg-black/18 p-4">
      <div className="h-4 w-20 rounded-full bg-white/10" />
      <div className="mt-4 h-6 w-4/5 rounded-full bg-white/10" />
      <div className="mt-2 h-4 w-3/5 rounded-full bg-white/10" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-16 rounded-[0.75rem] bg-white/8" />
        ))}
      </div>
      <div className="mt-6 h-20 rounded-[0.9rem] bg-amber-200/10" />
      <div className="mt-6 grid gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-5 rounded-full bg-white/8" />
        ))}
      </div>
      <div className="mt-6 h-11 rounded-full bg-white/10" />
    </div>
  );
}

function getTierBadgeClass(tier: SolarPanel["tier"]) {
  if (tier === "premium") {
    return "border-indigo-200/18 bg-indigo-300/14 text-indigo-100";
  }

  if (tier === "value") {
    return "border-emerald-200/18 bg-emerald-300/14 text-emerald-100";
  }

  return "border-sky-200/18 bg-sky-300/14 text-sky-100";
}

function PanelSpec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[0.75rem] border border-white/8 bg-black/20 p-2">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-white/70">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-white">{value}</p>
    </div>
  );
}

function PanelFinancialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 py-1.5 last:border-b-0">
      <span>{label}</span>
      <span className="shrink-0 font-semibold text-white">{value}</span>
    </div>
  );
}

function InverterSelector({
  annualSunlightHours,
  onSelectedInverterTypeChange,
  selectedInverterType,
  shadeRisk,
}: {
  annualSunlightHours: number;
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  selectedInverterType: InverterType;
  shadeRisk: string;
}) {
  const recommendation = getInverterRecommendation(annualSunlightHours);

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
                : option.id === recommendation.inverterType
                  ? "border-emerald-200/36 bg-emerald-200/[0.055]"
                : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{option.label}</p>
              {option.id === recommendation.inverterType ? (
                <span className="rounded-full bg-emerald-300/16 px-2 py-1 text-[0.5rem] font-bold uppercase tracking-[0.12em] text-emerald-100">
                  Recommended
                </span>
              ) : null}
            </div>
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
        {recommendation.note} Final equipment selection should be confirmed by the installer.
      </p>
    </div>
  );
}

function getInverterRecommendation(annualSunlightHours: number): {
  inverterType: InverterType;
  note: string;
} {
  if (annualSunlightHours > 1800) {
    return {
      inverterType: "string",
      note: "Low shade detected - string inverter is ideal.",
    };
  }

  if (annualSunlightHours >= 1400) {
    return {
      inverterType: "optimizers",
      note: "Moderate shade - optimizers will improve output.",
    };
  }

  return {
    inverterType: "microinverters",
    note: "Significant shade - microinverters strongly recommended.",
  };
}

function BatteryStorageSection({
  addBattery,
  batteryOption,
  onAddBatteryChange,
  onBatteryOptionChange,
}: {
  addBattery: boolean;
  batteryOption?: string;
  onAddBatteryChange?: (addBattery: boolean) => void;
  onBatteryOptionChange?: (batteryOption: string) => void;
}) {
  return (
    <section id="battery-storage" className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
            Battery backup
          </p>
          <h4 className="mt-1 text-lg font-semibold text-white">
            Add battery storage?
          </h4>
          <p className="mt-2 text-xs leading-5 text-white/50">
            Battery storage can provide backup power during outages. Capacity,
            backup duration, and current incentive eligibility require installer
            and tax-professional confirmation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAddBatteryChange?.(!addBattery)}
          className={`inline-flex min-h-11 min-w-32 items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition ${
            addBattery
              ? "bg-cyan-200 text-slate-950"
              : "border border-white/10 bg-white/[0.06] text-white/76 hover:bg-white/[0.1]"
          }`}
        >
          {addBattery ? "Battery added" : "Add battery"}
        </button>
      </div>

      {addBattery ? (
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {BATTERY_OPTIONS.map((battery) => (
            <BatteryCard
              key={battery.id}
              battery={battery}
              selected={getBatteryById(batteryOption).id === battery.id}
              onSelect={() => onBatteryOptionChange?.(battery.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BatteryCard({
  battery,
  onSelect,
  selected,
}: {
  battery: BatteryOption;
  onSelect: () => void;
  selected: boolean;
}) {
  const federalCredit = calculateFederalResidentialSolarCredit(battery.cost);
  const afterCredit = Math.max(battery.cost - federalCredit, 0);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-[0.95rem] border p-3 text-left transition ${
        selected
          ? "border-cyan-200/48 bg-cyan-200/[0.08]"
          : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">
            {battery.brand} {battery.model}
          </p>
          <p className="mt-1 text-xs leading-5 text-white/50">{battery.bestFor}</p>
        </div>
        {selected ? (
          <span className="rounded-full bg-cyan-200 px-2 py-1 text-[0.52rem] font-bold uppercase tracking-[0.12em] text-slate-950">
            Selected
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/58">
        <PanelFinancialRow label="Capacity" value={`${battery.capacityKwh} kWh`} />
        <PanelFinancialRow label="Backup" value={`~${battery.backupHours} hrs`} />
        <PanelFinancialRow label="Cost" value={formatMoney(battery.cost)} />
        <PanelFinancialRow label="Est. net cost" value={formatMoney(afterCredit)} />
        <PanelFinancialRow label="Warranty" value={`${battery.warrantyYears} yrs`} />
        <PanelFinancialRow label="Power" value={`${battery.powerKw} kW`} />
      </div>
    </button>
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
  const federalCreditRate = getFederalResidentialSolarCreditRate();

  return (
    <section className="rounded-[1rem] border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
            Available incentives
          </p>
          <h4 className="mt-1 text-lg font-semibold text-white">
            Current modeled tax incentives
          </h4>
        </div>
        <span className="rounded-full border border-emerald-200/16 bg-emerald-200/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
          Up to {formatMoney(totalIncentives)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <IncentiveCard
          title="Federal residential credit"
          source="Current IRS Section 25D guidance"
          body={
            federalCreditRate > 0
              ? `${Math.round(federalCreditRate * 100)}% modeled credit: ${formatMoney(federalCredit)}. Eligibility requires tax-professional confirmation.`
              : "No federal residential clean-energy credit is modeled for new 2026 expenditures under current IRS guidance. Confirm any project-specific eligibility with a tax professional."
          }
        />
        <IncentiveCard
          title="Arizona State Tax Credit"
          source="ARS 43-1083"
          body="Arizona law provides a nonrefundable residential solar credit equal to 25% of eligible cost, capped at $1,000. Eligibility and tax liability must be confirmed."
        />
        <IncentiveCard
          title="APS / SRP Net Metering"
          source="Utility tariff"
          body="Export compensation and remaining utility charges vary by current utility tariff and rate plan. Confirm them before purchase."
        />
        {utility ? (
          <IncentiveCard
            title={`${utility} program review`}
            source="Current utility tariff required"
            body="Ask the installer and utility to verify current export rates, interconnection charges, and any available storage programs."
          />
        ) : null}
      </div>
      <div className="mt-4 rounded-[0.95rem] border border-emerald-200/24 bg-emerald-300/16 px-4 py-3 text-sm font-semibold text-emerald-50 shadow-[0_14px_34px_rgba(16,185,129,0.12)]">
        Potential modeled tax credits: {formatMoney(totalIncentives)}. Actual
        eligibility depends on current law and individual tax circumstances.
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
  selectedPanelId,
  sortDirection,
  sortKey,
}: {
  fits: Array<{ panel: SolarPanel; fit: PanelFit }>;
  onSortKeyChange: (key: PanelSortKey) => void;
  selectedPanelId: string;
  sortDirection: "asc" | "desc";
  sortKey: PanelSortKey;
}) {
  const headers: Array<{ key: PanelSortKey; label: string }> = [
    { key: "brand", label: "Brand" },
    { key: "model", label: "Model" },
    { key: "watts", label: "Watts" },
    { key: "installedCostPerWatt", label: "AZ installed est. $/W" },
    { key: "efficiency", label: "Efficiency" },
    { key: "warranty_years", label: "Warranty" },
    { key: "azHeatLoss", label: "AZ Heat Loss" },
    { key: "netCost", label: "Net Cost" },
    { key: "paybackYears", label: "Modeled payback" },
  ];

  return (
    <div className="mt-4 overflow-x-auto rounded-[0.9rem] border border-white/10">
      <table className="min-w-[62rem] w-full text-left text-xs">
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
                  {sortKey === header.key
                    ? sortDirection === "asc"
                      ? " asc"
                      : " desc"
                    : ""}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-semibold uppercase tracking-[0.14em]">
              Panels
            </th>
          </tr>
        </thead>
        <tbody>
          {fits.map(({ fit, panel }) => (
            <tr
              key={panel.id}
              className={`border-t border-white/8 text-white/68 ${
                panel.id === selectedPanelId ? "bg-cyan-200/[0.08]" : ""
              }`}
            >
              <td className="px-3 py-2 font-semibold text-white">{panel.brand}</td>
              <td className="px-3 py-2">{panel.model}</td>
              <td className="px-3 py-2">{panel.watts}W</td>
              <td className="px-3 py-2">
                ${panel.installedCostPerWatt.toFixed(2)}
              </td>
              <td className="px-3 py-2">{panel.efficiency}%</td>
              <td className="px-3 py-2">{panel.warranty_years} yrs</td>
              <td className="px-3 py-2">{fit.azHeatLoss}</td>
              <td className="px-3 py-2">{formatMoney(fit.netCost)}</td>
              <td className="px-3 py-2">{fit.paybackYears.toFixed(1)} yrs</td>
              <td className="px-3 py-2">{fit.maxPanelsFit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportOverviewTab({
  onSendReport,
  values,
}: {
  onSendReport: () => void;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <CompactInfo
          icon={Sun}
          source="solar-api"
          title={`${values.advisor.suitability.score}/100`}
          body="Preliminary Solar Readiness Score for this roof."
          tone="gold"
        />
        <CompactInfo
          icon={Grid3X3}
          source="solar-api"
          title={`${values.panelCount} panels`}
          body={`${formatNumber(values.usableAreaSqFt)} square feet estimated solar-ready.`}
        />
        <CompactInfo
          icon={Zap}
          source="user-adjusted"
          title={`${values.recommendedKw.toFixed(1)} kW`}
          body="Estimated panel capacity. One kW equals 1,000 watts of panel power."
        />
        <CompactInfo
          icon={TrendingUp}
          source="user-adjusted"
          title={formatMoney(values.annualSavings)}
          body="Estimated annual savings using the monthly bill input."
          tone="gold"
        />
      </div>
      <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
          AI Solar Advisor
        </p>
        <p className="mt-3 text-sm leading-6 text-white/66">
          {values.advisor.summary}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniReadout label="20-year savings" source="modeled" value={formatMoney(values.twentyYearSavings)} />
          <MiniReadout label="Estimated annual bill covered" source="modeled" value={`${values.energyOffsetPct}%`} />
        </div>
        <button
          type="button"
          onClick={onSendReport}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
        >
          Send My Full Report
        </button>
      </div>
    </div>
  );
}

function RoofShadeTab({
  advisor,
  analysis,
  values,
}: {
  advisor: SolarAdvisorProfile;
  analysis: RoofAnalysis;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
          Roof and sunlight model
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniReadout label="Sunlight" source="solar-api" value={`${formatNumber(values.sunlightHours)} hrs`} />
          <MiniReadout label="Roof area" source="solar-api" value={`${formatNumber(values.usableAreaSqFt)} sq ft`} />
          <MiniReadout label="Orientation" source="solar-api" value={analysis.roofSegments[0]?.label ?? "Primary"} />
          <MiniReadout label="Shade risk" source="estimated" value={analysis.shadingRisk} />
        </div>
        <p className="mt-4 text-sm leading-6 text-white/58">
          Use the map layer toggles above the roof image to view panels, roof
          planes, and estimated sunlight quality. The heat layer is intentionally
          subtle so the roof remains readable.
        </p>
        <div className="mt-4 rounded-[0.9rem] border border-white/8 bg-slate-950/34 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/76">
            Installer verification checklist
          </p>
          <ul className="mt-3 grid gap-2 text-xs leading-5 text-white/58">
            <li>Confirm roof measurements, condition, obstructions, and fire setbacks.</li>
            <li>Verify electrical service capacity and utility interconnection requirements.</li>
            <li>Confirm equipment, tariff, incentives, production, and final pricing.</li>
          </ul>
          <p className="mt-3 text-xs leading-5 text-cyan-100/72">
            These items require an on-site installer review and are not editable in this preliminary homeowner model.
          </p>
        </div>
      </div>
      <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-white/70">
          Estimated sunlight quality
        </p>
        <p className="mt-2 text-lg font-semibold text-white">
          {advisor.sunlightQuality.label} / {advisor.sunlightQuality.score}
        </p>
        <p className="mt-3 text-sm leading-6 text-white/58">
          {advisor.sunlightQuality.summary}
        </p>
        <div className="mt-4 grid gap-2">
          {advisor.sunlightQuality.segments.slice(0, 3).map((segment) => (
            <MiniReadout
              key={segment.label}
              label={segment.label}
              source="estimated"
              value={`${segment.score}/100`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        title={`${values.panelCount} panels`}
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

function SavingsTab({
  onMonthlyBillChange,
  values,
}: {
  onMonthlyBillChange: (monthlyBill: number) => void;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">
            Monthly electric bill
          </p>
          <select
            value={values.monthlyBill}
            onChange={(event) => onMonthlyBillChange(Number(event.target.value))}
            className="mt-3 w-full rounded-full border border-white/12 bg-black/35 px-4 py-3 text-base font-semibold text-white outline-none transition focus:border-cyan-200/50"
          >
            {monthlyBillOptions.map((value) => (
              <option key={value} value={value} className="bg-slate-950">
                {formatMoney(value)}
              </option>
            ))}
          </select>
          <BillComparisonCard values={values} />
        </div>
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        <p className="text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-white/70">
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
  const [showDetails, setShowDetails] = useState(false);
  const downPaymentAmount = Math.round(
    values.installedCost * (downPaymentPct / 100)
  );
  const loanPrincipal = Math.max(
    values.installedCost - downPaymentAmount,
    0
  );
  const monthlyLoanPayment = calculateMonthlyLoanPayment(
    loanPrincipal,
    loanRate,
    loanTermYears
  );
  const netMonthly = values.monthlySavings - monthlyLoanPayment;
  const loanCosts = calculateTwentyYearSolarCosts({
    annualSavings: values.annualSavings,
    monthlyBill: values.monthlyBill,
    totalSolarPayments:
      downPaymentAmount + monthlyLoanPayment * loanTermYears * 12,
  });

  return (
    <div
      id="financing-calculator"
      className="grid scroll-mt-24 gap-4 lg:grid-cols-[0.95fr_1.05fr]"
    >
      <div className="rounded-[1rem] border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-cyan-100/78">
              Financing comparison
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              Illustrative financing scenarios
            </h3>
          </div>
          <span className="rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-amber-100">
            Not a loan offer
          </span>
        </div>
        <div className="grid grid-cols-3 rounded-full border border-white/10 bg-black/24 p-1">
          {(["buy", "lease", "loan"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={financingMode === mode}
              onClick={() => onFinancingModeChange(mode)}
              className={`min-h-11 rounded-full px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] transition ${
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
          Financing values are illustrative only. Final pricing, eligibility,
          incentives, APR, dealer fees, and terms require installer, lender, and
          tax-professional confirmation. No federal residential credit is assumed
          for new 2026 expenditures under current IRS guidance.
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
                  ? `Modeled energy savings less payment: ${formatMoney(netMonthly)} / mo`
                  : `Modeled payment gap: ${formatMoney(Math.abs(netMonthly))} / mo`}
              </p>
            </div>
          </div>
        ) : null}
        <div className="mt-4 grid gap-2">
          {financingMode === "buy" ? (
            <>
              <MiniReadout label="System cost" source="illustrative" value={formatMoney(values.installedCost)} />
              <MiniReadout label="Modeled federal credit" source="illustrative" value={formatMoney(values.taxCredit)} />
              <MiniReadout label="Estimated net cost" source="illustrative" value={formatMoney(values.netCostAfterCredit)} />
              <MiniReadout label="Modeled payback" source="modeled" value={`${values.paybackYears.toFixed(1)} years`} />
            </>
          ) : null}
          {financingMode === "lease" ? (
            <>
              <MiniReadout label="Upfront payment" source="illustrative" value="Provider quote required" />
              <MiniReadout label="Monthly lease or PPA price" source="illustrative" value="Provider quote required" />
              <MiniReadout label="Monthly bill savings" source="user-adjusted" value={formatMoney(values.monthlySavings)} />
            </>
          ) : null}
          <MiniReadout
            label={financingMode === "buy" ? "Estimated cash cost" : "Selected down payment"}
            note={
              financingMode === "buy"
                ? "Uses current federal residential credit guidance; Arizona credit is shown separately and is not deducted here."
                : financingMode === "loan"
                  ? "No tax credit is automatically deducted from this loan principal."
                  : "Lease and PPA terms require a provider quote."
            }
            source="illustrative"
            value={
              financingMode === "buy"
                ? formatMoney(values.netCostAfterCredit)
                : financingMode === "loan"
                  ? formatMoney(downPaymentAmount)
                  : "Provider quote required"
            }
          />
          <MiniReadout
            label="20-year net savings"
            source="illustrative"
            value={
              financingMode === "buy"
                ? formatMoney(values.twentyYearSavings)
                : financingMode === "loan"
                  ? formatMoney(loanCosts.totalSavings)
                  : "Not modeled without provider terms"
            }
          />
        </div>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <MiniReadout label="Cash net cost" source="illustrative" value={formatMoney(values.netCostAfterCredit)} />
          <MiniReadout label="Loan payment basis" source="illustrative" value={formatMoney(monthlyLoanPayment)} />
          <MiniReadout label="Lease / PPA pricing" source="illustrative" value="Provider quote required" />
        </div>
        <button
          type="button"
          aria-controls="financing-assumptions"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((current) => !current)}
          className="min-h-11 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/78 transition hover:bg-white/[0.1] hover:text-white"
        >
          {showDetails ? "Hide assumptions and exclusions" : "View assumptions and exclusions"}
        </button>
        {showDetails ? (
          <div id="financing-assumptions" className="grid gap-4">
            {financingMode === "lease" ? (
              <p className="rounded-[1rem] border border-amber-200/15 bg-amber-300/8 p-4 text-sm leading-6 text-amber-50/80">
                A lease or PPA cannot be modeled responsibly without a provider
                price, escalator, term, buyout schedule, and production guarantee.
              </p>
            ) : (
              <EstimateTable rows={values.financingRows} />
            )}
            <AssumptionTable rows={values.financingAssumptions} />
          </div>
        ) : null}
      </div>
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

function SendReportTab({
  sendReportContent,
}: {
  sendReportContent?: ReactNode;
}) {
  return (
    <div id="generate-report" className="scroll-mt-24">
      {sendReportContent ?? (
        <div className="rounded-[1rem] border border-white/10 bg-black/20 p-5">
          <h3 className="text-xl font-semibold text-white">Send My Full Report</h3>
          <p className="mt-2 text-sm leading-6 text-white/60">
            The quote request form is unavailable in this preview, but the report model is ready.
          </p>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          href="#report-dashboard"
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-white/70">
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
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/70">
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
      <div className="mt-4 flex flex-wrap gap-2">
        {advisor.questions.map((item, index) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onSelectQuestion(index)}
            className={`min-h-11 rounded-full px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.12em] transition ${
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
    manufacturer: "border-sky-200/18 bg-sky-200/10 text-sky-100",
    modeled: "border-amber-200/18 bg-amber-200/10 text-amber-100",
    "user-adjusted": "border-emerald-200/18 bg-emerald-200/10 text-emerald-100",
    illustrative: "border-slate-200/18 bg-white/8 text-slate-200",
    estimated: "border-fuchsia-200/18 bg-fuchsia-200/10 text-fuchsia-100",
  };
  const labels: Record<MetricSource, string> = {
    "solar-api": "Solar API",
    manufacturer: "Manufacturer",
    modeled: "Modeled",
    "user-adjusted": "User-adjusted",
    illustrative: "Illustrative",
    estimated: "Estimated",
  };
  const descriptions: Record<MetricSource, string> = {
    "solar-api": "Based on available Google Solar API roof and sunlight data",
    manufacturer: "Published by the named panel manufacturer",
    modeled: "Calculated from stated assumptions and available report data",
    "user-adjusted": "Updates when you change the bill or panel settings",
    illustrative: "Example scenario only; not a quote or offer",
    estimated: "Preliminary estimate requiring installer verification",
  };

  return (
    <span
      aria-label={`${labels[source]}: ${descriptions[source]}`}
      title={descriptions[source]}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-white/70">
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
    <article className="min-w-0 rounded-[1rem] border border-white/10 bg-black/20 p-3 sm:p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${accent}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="mt-3">
        <SourceBadge source={source} />
      </div>
      <h3 className="mt-3 break-words text-lg font-semibold text-white sm:mt-4 sm:text-xl">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-white/60 sm:text-sm sm:leading-6">{body}</p>
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
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/70">
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
        <p className="text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-white/70">
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
  inverterCostAdderPerWatt = 0,
  selectedBattery: BatteryOption | null = null
) {
  const activeEstimate = buildActiveSolarEstimate({
    analysis,
    batteryCost: selectedBattery?.cost,
    inverterCostAdderPerWatt,
    monthlyBill,
    selectedPanel,
    selectedPanelCount: activePanelCount,
  });
  const {
    annualKwh,
    annualSavings,
    baseMetrics,
    billWithSolar,
    energyOffsetPct,
    excludedCandidateCount,
    installedCost,
    maxPanelCount,
    monthlySavings,
    netCostAfterCredit,
    panelCount,
    paybackYears,
    recommendedPanelCount,
    remainingPanelCapacity,
    selectedPanelFit,
    systemKw,
    taxCredit,
    twentyYearCashCosts,
  } = activeEstimate;
  const panelAdjustedMetrics = {
    ...baseMetrics,
    annualKwh,
    annualSavings,
    coveragePct: energyOffsetPct,
    monthlySavings,
    panelCount,
    paybackYears,
    systemKw,
  };
  const advisor = buildSolarAdvisorProfile(
    buildSolarAdvisorInputFromAnalysis(
      {
        ...analysis,
        annualKwh,
        annualSavingsUSD: annualSavings,
        panelCapacityWatts: selectedPanel.watts,
        panelCount,
        systemKw,
      },
      panelAdjustedMetrics,
      monthlyBill
    )
  );
  const usableAreaSqFt = Math.round(baseMetrics.usableRoofAreaM2 * 10.7639);
  const recommendedKw = systemKw;
  const azRatePerKwh = ARIZONA_AVG_RATE_PER_KWH;
  const panelAreaSqFt = getPanelAreaM2(selectedPanel) * 10.7639;
  const installationSqFt = Math.round(panelCount * panelAreaSqFt);
  const carbonFactorKgPerMwh =
    analysis.carbonOffsetFactorKgPerMwh && analysis.carbonOffsetFactorKgPerMwh > 0
      ? analysis.carbonOffsetFactorKgPerMwh
      : 390;
  const carbonMetricTons = roundTo(
    ((annualKwh / 1000) * carbonFactorKgPerMwh * 2.205) / 2205,
    1
  );
  const carsRemoved = roundTo(carbonMetricTons / 4.6, 1);
  const treesEquivalent = roundTo(carbonMetricTons * 16.7, 1);
  const federalCreditRate = getFederalResidentialSolarCreditRate();
  const utilityEscalationRate = 0.03;
  const defaultLoanRate = 6.49;
  const defaultLoanTermYears = 20;
  const batteryCost = selectedBattery?.cost ?? 0;
  const upfrontAfterIncentives =
    financingMode === "buy" ? netCostAfterCredit : 0;
  const baselineLoanPayment = calculateMonthlyLoanPayment(
    installedCost,
    defaultLoanRate,
    defaultLoanTermYears
  );
  const totalPayments =
    financingMode === "buy"
      ? upfrontAfterIncentives
      : financingMode === "lease"
        ? 0
        : baselineLoanPayment * defaultLoanTermYears * 12;
  const financingCosts = calculateTwentyYearSolarCosts({
    annualSavings,
    monthlyBill,
    totalSolarPayments: totalPayments,
    utilityEscalationRate,
  });

  return {
    advisor,
    annualKwh,
    annualSavings,
    carbonMetricTons,
    carsRemoved,
    financingRows: [
      { label: "Up-front cost of installation", source: "illustrative" as const, value: upfrontAfterIncentives },
      { label: "Total payments over 20 years", source: "illustrative" as const, value: totalPayments },
      { label: "Total 20-year cost with solar", source: "illustrative" as const, value: financingCosts.totalCostWithSolar },
      { label: "Total 20-year cost without solar", source: "modeled" as const, value: financingCosts.totalCostWithoutSolar },
      { label: "Total 20-year savings", source: "illustrative" as const, value: financingCosts.totalSavings },
    ],
    financingAssumptions: [
      { label: "Arizona electricity rate", value: `$${azRatePerKwh.toFixed(2)}/kWh` },
      {
        label: "Installed cost basis",
        value: `$${(selectedPanel.installedCostPerWatt + inverterCostAdderPerWatt).toFixed(2)}/W${
          selectedBattery ? ` + ${formatMoney(batteryCost)} battery` : ""
        }`,
      },
      { label: "Utility escalation", value: `${Math.round(utilityEscalationRate * 100)}% / yr` },
      {
        label: "Modeled federal residential credit",
        value:
          federalCreditRate > 0
            ? `${Math.round(federalCreditRate * 100)}% (eligibility not guaranteed)`
            : "0% for new 2026 expenditures under current IRS guidance",
      },
      { label: "Baseline loan scenario", value: `${defaultLoanRate.toFixed(2)}% APR / ${defaultLoanTermYears} years, before fees` },
      { label: "Remaining utility charges", value: "Not fully modeled; fixed and demand charges may remain" },
      { label: "Production degradation", value: "Not modeled; installer production warranty required" },
      { label: "Export compensation", value: "Not modeled; verify the applicable utility tariff" },
      { label: "Dealer or origination fees", value: "Not modeled; confirm with the lender or installer" },
      { label: "Maintenance and replacement reserve", value: "Not modeled; verify warranty and long-term service terms" },
    ],
    installationSqFt,
    energyOffsetPct,
    batteryCost,
    installedCost,
    maxPanelCount,
    monthlyBill,
    monthlySavings,
    billWithSolar,
    netCostAfterCredit,
    panelCount,
    paybackYears,
    recommendedKw,
    recommendedPanelCount,
    excludedCandidateCount,
    remainingPanelCapacity,
    selectedPanelFit,
    selectedPanel,
    selectedBattery,
    savingsRows: [
      { label: "Average annual savings", source: "user-adjusted" as const, value: annualSavings },
      { label: "Total 20-year cost with solar", source: "illustrative" as const, value: twentyYearCashCosts.totalCostWithSolar },
      { label: "Total 20-year cost without solar", source: "modeled" as const, value: twentyYearCashCosts.totalCostWithoutSolar },
      { label: "Total 20-year cash savings", source: "modeled" as const, value: twentyYearCashCosts.totalSavings },
    ],
    sunlightHours: analysis.annualSunlightHours,
    totalSavings: twentyYearCashCosts.totalSavings,
    treesEquivalent,
    twentyYearSavings: twentyYearCashCosts.totalSavings,
    taxCredit,
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
