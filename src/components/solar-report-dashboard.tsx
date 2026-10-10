"use client";

import { ChevronDown } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import { RedactedScenarioShareCard } from "@/components/redacted-scenario-share-card";
import { billOptionsIncluding } from "@/lib/monthly-bill-options";
import {
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  type SolarAdvisorProfile,
} from "@/lib/solar-advisor";
import {
  ARIZONA_AVG_RATE_PER_KWH,
} from "@/lib/solar-metrics";
import {
  ARIZONA_EXPORT_CREDIT_PER_KWH,
  ARIZONA_EXPORT_CREDIT_SOURCE,
  ARIZONA_FIXED_MONTHLY_CHARGE,
  ARIZONA_INSTALLED_COST_MARKET,
  SOLAR_SELF_CONSUMPTION_SHARE,
} from "@/lib/solar-assumptions";
import { buildActiveSolarEstimate, getActiveEstimateMetrics } from "@/lib/active-solar-estimate";
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
  onSelectedInverterTypeChange?: (inverterType: InverterType) => void;
  onSelectedPanelIdChange?: (panelId: string) => void;
  onAddBatteryChange?: (addBattery: boolean) => void;
  onBatteryOptionChange?: (batteryOption: string) => void;
  /** Given only where the page has no header bill picker (the iOS app). */
  onMonthlyBillChange?: (monthlyBill: number) => void;
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

const DEFAULT_LOAN_RATE = 6.49;
const DEFAULT_LOAN_TERM_YEARS = 20;

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "roof", label: "Roof & shade" },
  { id: "panels", label: "Panels" },
  { id: "savings", label: "Savings" },
  { id: "financing", label: "Financing" },
  // The iOS app finds this tab by its exact text ("Send Report"); keep it in sync with
  // mobile/src/analysis-bridge.ts before renaming.
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
  const [reportFormOpened, setReportFormOpened] = useState(activeTab === "send");
  if (activeTab === "send" && !reportFormOpened) {
    setReportFormOpened(true);
  }
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

  const setActiveTab = (tab: DetailTab) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };
  const handleDetailTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: DetailTab
  ) => {
    const currentTabIndex = detailTabs.findIndex(({ id }) => id === currentTab);
    if (currentTabIndex === -1) {
      return;
    }

    let nextTabIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextTabIndex = (currentTabIndex + 1) % detailTabs.length;
        break;
      case "ArrowLeft":
        nextTabIndex =
          (currentTabIndex - 1 + detailTabs.length) % detailTabs.length;
        break;
      case "Home":
        nextTabIndex = 0;
        break;
      case "End":
        nextTabIndex = detailTabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = detailTabs[nextTabIndex].id;
    setActiveTab(nextTab);
    document.getElementById(`report-tab-${nextTab}`)?.focus();
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
    <section
      id="report-dashboard"
      className="w-full min-w-0 max-w-full rounded-card border border-ridge bg-dusk p-3 sm:p-4 lg:col-span-12"
    >
      <div
        role="tablist"
        aria-label="Solar report detail sections"
        className="grid grid-cols-3 gap-1 rounded-card border border-ridge bg-night p-1 xl:grid-cols-6 xl:rounded-full"
      >
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            id={`report-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            aria-controls="report-tabpanel"
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleDetailTabKeyDown(event, tab.id)}
            className={`min-h-11 rounded-full px-2 py-2 text-sm font-semibold leading-5 xl:px-4 ${
              activeTab === tab.id
                ? "bg-ink text-night"
                : "text-ink-muted hover:text-ink"
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
              analysis={analysis}
              onSendReport={openSendReport}
              onSelectQuestion={setSelectedAdvisorQuestion}
              selectedQuestion={selectedAdvisorQuestion}
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
              imageryDate={analysis.imageryDate}
              onMonthlyBillChange={onMonthlyBillChange}
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
          <div hidden={activeTab !== "send"}>
            {reportFormOpened ? <SendReportTab sendReportContent={sendReportContent} /> : null}
          </div>
      </div>
    </section>
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
          <p className="text-xs font-semibold text-sky-100/82">
            Panel selection
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-ink">
            Recommended panel for this roof
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
            We show the current panel first, then a few alternatives. Open the
            comparison table only if you want the full equipment catalog.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-dim">
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
            <div className="rounded-card border border-white/10 bg-black/18 p-4">
              <p className="text-sm font-semibold text-ink">Why this panel?</p>
              <p className="mt-2 text-sm leading-6 text-ink-dim">
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

      <div className="overflow-hidden rounded-card border border-white/10 bg-black/18 p-4">
        <button
          type="button"
          onClick={() => setShowComparison((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-ink">
              {showComparison ? "Hide comparison" : "Compare all panels"}
            </span>
            <span className="mt-1 block text-xs text-ink-muted">
              Sorted by payback by default.
            </span>
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-ink-muted">
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
      className={`relative flex h-full flex-col overflow-hidden rounded-card border p-4 transition ${
        isSelected
          ? "border-sky-300 bg-raised"
          : "border-ridge bg-night/40"
      } ${isFeatured ? "min-h-[25rem]" : "min-h-[18rem]"}`}
    >
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
        {isSelected ? (
          <span className="rounded-full bg-sky-200 px-2 py-1 text-xs font-black text-slate-950">
            Selected
          </span>
        ) : null}
        {fit.recommended ? (
          <span className="rounded-full bg-emerald-300 px-2 py-1 text-xs font-black text-slate-950">
            Recommended
          </span>
        ) : null}
        {!fit.fits ? (
          <span className="rounded-full bg-slate-500/70 px-2 py-1 text-xs font-black text-ink">
            Roof too small
          </span>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-3 pr-24">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{panel.brand}</p>
          <h4 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
            {panel.model}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-dim">{panel.bestFor}</p>
          <a
            href={panel.specSourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex text-xs font-medium text-sky-100/70 underline decoration-sky-100/25 underline-offset-2 hover:text-sky-100"
          >
            Manufacturer specifications
          </a>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-bold ${getTierBadgeClass(panel.tier)}`}>
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
      <div className="mt-4 rounded-card border border-amber-200/14 bg-amber-200/[0.06] p-3">
        <p className="text-xs font-semibold text-amber-100">
          {fit.azHeatLoss}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          Temperature coefficient: {panel.tempCoefficient}% / C.
        </p>
      </div>
      ) : null}

      <div className="mt-auto grid gap-1.5 pt-4 text-xs text-ink-dim">
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
            : "border border-white/10 bg-white/[0.06] text-ink hover:bg-white/[0.1]"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isSelected ? "Selected panel" : "Select this panel"}
      </button>
    </article>
  );
}

function PanelOptionSkeleton() {
  return (
    <div className="min-h-[18rem] animate-pulse rounded-card border border-white/10 bg-black/18 p-4">
      <div className="h-4 w-20 rounded-full bg-white/10" />
      <div className="mt-4 h-6 w-4/5 rounded-full bg-white/10" />
      <div className="mt-2 h-4 w-3/5 rounded-full bg-white/10" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-16 rounded-card bg-white/8" />
        ))}
      </div>
      <div className="mt-6 h-20 rounded-card bg-amber-200/10" />
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
    <div className="min-w-0 overflow-hidden rounded-card border border-white/8 bg-black/20 p-2">
      <p className="text-xs font-semibold text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-ink">{value}</p>
    </div>
  );
}

function PanelFinancialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 py-1.5 last:border-b-0">
      <span>{label}</span>
      <span className="shrink-0 font-semibold text-ink">{value}</span>
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
    <div className="rounded-card border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-sky-100/80">
            Inverter option
          </p>
          <h4 className="mt-1 text-lg font-semibold text-ink">
            Match electronics to roof shade
          </h4>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-muted">
          Shade risk: {shadeRisk}
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {INVERTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectedInverterTypeChange?.(option.id)}
            className={`rounded-card border p-3 text-left transition ${
              option.id === selectedInverterType
                ? "border-sky-200/42 bg-sky-200/[0.075]"
                : option.id === recommendation.inverterType
                  ? "border-emerald-200/36 bg-emerald-200/[0.055]"
                : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{option.label}</p>
              {option.id === recommendation.inverterType ? (
                <span className="rounded-full bg-emerald-300/16 px-2 py-1 text-xs font-bold text-emerald-100">
                  Recommended
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-dim">{option.brands}</p>
            <p className="mt-2 text-xs font-semibold text-sky-100">
              {option.costAdderPerWatt > 0
                ? `+$${option.costAdderPerWatt.toFixed(2)}/W`
                : "$0/W add-on"}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{option.bestFor}</p>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-ink-dim">
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
    <section id="battery-storage" className="rounded-card border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold text-sky-100/80">
            Battery backup
          </p>
          <h4 className="mt-1 text-lg font-semibold text-ink">
            Add battery storage?
          </h4>
          <p className="mt-2 text-xs leading-5 text-ink-dim">
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
              ? "bg-sky-200 text-slate-950"
              : "border border-white/10 bg-white/[0.06] text-ink-muted hover:bg-white/[0.1]"
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
      className={`rounded-card border p-3 text-left transition ${
        selected
          ? "border-sky-200/48 bg-sky-200/[0.08]"
          : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            {battery.brand} {battery.model}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-dim">{battery.bestFor}</p>
        </div>
        {selected ? (
          <span className="rounded-full bg-sky-200 px-2 py-1 text-xs font-bold text-slate-950">
            Selected
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-dim">
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
    <section className="rounded-card border border-white/10 bg-black/18 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold text-sky-100/80">
            Available incentives
          </p>
          <h4 className="mt-1 text-lg font-semibold text-ink">
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
      <div className="mt-4 rounded-card border border-emerald-200/24 bg-emerald-300/16 px-4 py-3 text-sm font-semibold text-emerald-50">
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
    <article className="rounded-card border border-white/8 bg-white/[0.035] p-3">
      <h5 className="text-sm font-semibold text-ink">{title}</h5>
      <p className="mt-2 text-xs leading-5 text-ink-dim">{body}</p>
      <p className="mt-2 text-xs font-semibold text-sky-100/70">
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
    <div className="mt-4 overflow-x-auto rounded-card border border-white/10">
      <table className="min-w-[62rem] w-full text-left text-xs">
        <thead className="bg-white/[0.05] text-ink-dim">
          <tr>
            {headers.map((header) => (
              <th key={header.key} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSortKeyChange(header.key)}
                  className={`font-semibold ${
                    sortKey === header.key ? "text-sky-100" : ""
                  }`}
                >
                  {header.label}
                  {sortKey === header.key
                    ? sortDirection === "asc"
                      ?" asc"
                      :" desc"
                    : ""}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-semibold">
              Panels
            </th>
          </tr>
        </thead>
        <tbody>
          {fits.map(({ fit, panel }) => (
            <tr
              key={panel.id}
              className={`border-t border-white/8 text-ink-muted ${
                panel.id === selectedPanelId ? "bg-sky-200/[0.08]" : ""
              }`}
            >
              <td className="px-3 py-2 font-semibold text-ink">{panel.brand}</td>
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
  analysis,
  onSelectQuestion,
  onSendReport,
  selectedQuestion,
  values,
}: {
  analysis: RoofAnalysis;
  onSelectQuestion: (index: number) => void;
  onSendReport: () => void;
  selectedQuestion: number;
  values: DashboardValues;
}) {
  const { advisor } = values;
  const activeQuestion = advisor.questions[selectedQuestion] ?? advisor.questions[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section aria-labelledby="overview-meaning-heading" className="rounded-card border border-ridge bg-night/50 p-4 sm:p-5">
        <h3 id="overview-meaning-heading" className="text-lg font-semibold text-ink">
          What this means for your home
        </h3>
        <p className="mt-2 text-[0.9375rem] leading-7 text-ink-muted">{advisor.summary}</p>

        <div className="mt-5 border-t border-ridge pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-ink">
              Why the readiness score is {advisor.suitability.score}/100
            </h4>
            <span className="tag">{toSentenceCase(advisor.candidateLabel)}</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-dim">
            A modeled score from your roof&rsquo;s usable area, sunlight and shade. It&rsquo;s our
            estimate, not a rating from Google or an installer.
          </p>
          <ul className="mt-3 grid gap-2 text-sm leading-6">
            {advisor.suitability.positiveFactors.slice(0, 3).map((factor) => (
              <li key={factor} className="flex gap-2.5 text-ink-muted">
                <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gain" />
                {factor}
              </li>
            ))}
            {advisor.suitability.limitingFactors.slice(0, 2).map((factor) => (
              <li key={factor} className="flex gap-2.5 text-ink-muted">
                <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sun" />
                {factor}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 border-t border-ridge pt-4">
          <h4 className="text-base font-semibold text-ink">Common questions</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {advisor.questions.map((item, index) => (
              <button
                key={item.question}
                type="button"
                aria-pressed={index === selectedQuestion}
                onClick={() => onSelectQuestion(index)}
                className={`min-h-11 rounded-full px-3.5 py-2 text-sm font-semibold ${
                  index === selectedQuestion
                    ? "bg-ink text-night"
                    : "border border-ridge text-ink-muted hover:text-ink"
                }`}
              >
                {item.question}
              </button>
            ))}
          </div>
          {activeQuestion ? (
            <p className="mt-3 text-sm leading-6 text-ink-muted">{activeQuestion.answer}</p>
          ) : null}
        </div>
      </section>

      <div className="grid content-start gap-4">
        <section aria-labelledby="overview-longterm-heading" className="rounded-card border border-ridge bg-night/50 p-4 sm:p-5">
          <h3 id="overview-longterm-heading" className="text-lg font-semibold text-ink">
            The longer view
          </h3>
          <dl className="mt-2 divide-y divide-ridge">
            <OverviewStat
              label={values.twentyYearSavings < 0 ? "20-year net loss" : "20-year savings"}
              value={formatMoney(values.twentyYearSavings)}
              note="Utility costs minus solar costs over 20 years. It isn't the yearly savings times 20."
            />
            <OverviewStat label="Electricity use covered by solar" value={`${values.energyOffsetPct}%`} />
            <OverviewStat
              label="Payback"
              value={formatPaybackYears(values.paybackYears)}
              note="Years until savings cover the system's net cost."
            />
          </dl>
          <button type="button" onClick={onSendReport} className="btn btn-primary mt-4 w-full">
            Send my full report
          </button>
        </section>

        <details id="scenario-share-disclosure" className="group rounded-card border border-ridge bg-night/50">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-semibold text-ink sm:px-5">
            Share a privacy-safe summary
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-dim transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <RedactedScenarioShareCard
              roofShape={analysis.roofShape}
              shadingRisk={analysis.shadingRisk}
              systemKw={values.recommendedKw}
            />
          </div>
        </details>
      </div>
    </div>
  );
}

function OverviewStat({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold text-ink">{value}</dd>
      {note ? <dd className="col-span-2 mt-1 text-xs leading-5 text-ink-dim">{note}</dd> : null}
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
      <div className="rounded-card border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-semibold text-sky-100/80">
          Roof and sunlight model
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniReadout label="Sunlight" source="solar-api" value={`${formatNumber(values.sunlightHours)} hrs`} />
          <MiniReadout label="Roof area" source="solar-api" value={`${formatNumber(values.usableAreaSqFt)} sq ft`} />
          <MiniReadout label="Orientation" source="solar-api" value={analysis.roofSegments[0]?.label ?? "Primary"} />
          <MiniReadout label="Shade risk" source="estimated" value={capitalize(analysis.shadingRisk)} />
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-dim">
          Use the map layer toggles above the roof image to view panels, roof
          planes, and estimated sunlight quality. The heat layer is intentionally
          subtle so the roof remains readable.
        </p>
        <div className="mt-4 rounded-card border border-white/8 bg-slate-950/34 p-3">
          <p className="text-xs font-semibold text-ink-muted">
            Installer verification checklist
          </p>
          <ul className="mt-3 grid gap-2 text-xs leading-5 text-ink-dim">
            <li>Confirm roof measurements, condition, obstructions, and fire setbacks.</li>
            <li>Verify electrical service capacity and utility interconnection requirements.</li>
            <li>Confirm equipment, tariff, incentives, production, and final pricing.</li>
          </ul>
          <p className="mt-3 text-xs leading-5 text-sky-100/72">
            These items require an on-site installer review and are not editable in this preliminary homeowner model.
          </p>
        </div>
      </div>
      <div className="rounded-card border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-semibold text-ink-muted">
          Estimated sunlight quality
        </p>
        <p className="mt-2 text-lg font-semibold text-ink">
          {advisor.sunlightQuality.label} / {advisor.sunlightQuality.score}
        </p>
        <p className="mt-3 text-sm leading-6 text-ink-dim">
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

function SavingsTab({
  imageryDate,
  onMonthlyBillChange,
  values,
}: {
  imageryDate?: string | null;
  onMonthlyBillChange?: (monthlyBill: number) => void;
  values: DashboardValues;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-labelledby="savings-bill-heading" className="rounded-card border border-ridge bg-night/50 p-4 sm:p-5">
          <h3 id="savings-bill-heading" className="text-lg font-semibold text-ink">
            Your monthly bill
          </h3>
          {onMonthlyBillChange ? (
            <div className="mt-3">
              <label htmlFor="savings-monthly-bill" className="field-label">
                Monthly electric bill
              </label>
              <select
                id="savings-monthly-bill"
                value={values.monthlyBill}
                onChange={(event) => onMonthlyBillChange(Number(event.target.value))}
                className="field-input mt-2 font-semibold"
              >
                {billOptionsIncluding(values.monthlyBill).map((value) => (
                  <option key={value} value={value} className="bg-night">
                    {formatMoney(value)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-1 text-sm leading-6 text-ink-dim">
              Based on a {formatMoney(values.monthlyBill)} average bill. Change it at the top of the page.
            </p>
          )}
          <BillComparisonCard values={values} />
        </section>
        <section aria-labelledby="savings-time-heading" className="rounded-card border border-ridge bg-night/50 p-4 sm:p-5">
          <h3 id="savings-time-heading" className="text-lg font-semibold text-ink">
            Savings over time
          </h3>
          <div className="mt-3">
            <EstimateTable rows={values.savingsRows} />
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-dim">
            Annual savings is a first-year estimate. The 20-year figures compare what you&rsquo;d pay the
            utility with and without solar; they aren&rsquo;t the yearly savings times 20. Payback is the
            time for savings to cover the system&rsquo;s net cost, not a loan term.
          </p>
        </section>
      </div>
      <HowThisWasCalculated imageryDate={imageryDate} values={values} />
    </div>
  );
}

/** Every input behind the savings figures, in plain language, with sources. */
function HowThisWasCalculated({
  imageryDate,
  values,
}: {
  imageryDate?: string | null;
  values: DashboardValues;
}) {
  const imageryMonth = formatImageryMonth(imageryDate);
  const rows: Array<{ term: string; detail: ReactNode }> = [
    {
      term: "Solar production",
      detail: `${formatNumber(values.annualKwh)} kWh per year from ${values.panelCount} panels`,
    },
    {
      term: "Electricity price",
      detail: `$${ARIZONA_AVG_RATE_PER_KWH.toFixed(3)} per kWh, the Arizona residential average`,
    },
    {
      term: "Power sent to the grid",
      detail: (
        <>
          Credited at ${ARIZONA_EXPORT_CREDIT_PER_KWH.toFixed(4)} per kWh (
          <a
            className="text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink"
            href={ARIZONA_EXPORT_CREDIT_SOURCE.url}
            rel="noreferrer"
            target="_blank"
          >
            {ARIZONA_EXPORT_CREDIT_SOURCE.label}
          </a>
          )
        </>
      ),
    },
    {
      term: "Fixed charge",
      detail: `$${ARIZONA_FIXED_MONTHLY_CHARGE} a month stays on your bill, the utility's basic service charge`,
    },
    {
      term: "Solar used at home",
      detail: `${Math.round(SOLAR_SELF_CONSUMPTION_SHARE * 100)}% of production is used as it's made; the rest is sent to the grid`,
    },
    {
      term: "Installed cost",
      detail: `$${values.costPerWatt.toFixed(2)} per watt before incentives`,
    },
    {
      term: "Roof imagery",
      detail: imageryMonth ? `Aerial photos taken ${imageryMonth}` : "Google didn't report when the photos were taken",
    },
  ];

  return (
    <section
      aria-labelledby="how-calculated-heading"
      className="rounded-card border border-ridge bg-night/50 p-4 sm:p-5"
    >
      <h3 id="how-calculated-heading" className="text-lg font-semibold text-ink">
        How this estimate was calculated
      </h3>
      <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.term}>
            <dt className="text-sm font-semibold text-ink">{row.term}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-ink-muted">{row.detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-5 text-ink-dim">
        Roof shape, sunlight and panel positions come from Google&rsquo;s Solar data for this address. Savings
        and costs are our estimates from the figures above, so an installer&rsquo;s quote will differ.
      </p>
    </section>
  );
}

/** "2023-09-26" → "September 2023"; null when the date is missing or malformed. */
function formatImageryMonth(imageryDate?: string | null) {
  const match = imageryDate?.match(/^(\d{4})-(\d{2})/);
  if (!match) {
    return null;
  }
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
}

function BillComparisonCard({ values }: { values: DashboardValues }) {
  const currentBill = Math.max(values.monthlyBill, 1);
  const withSolar = Math.max(values.billWithSolar, 0);
  const solarPct = clamp((withSolar / currentBill) * 100, 0, 100);

  return (
    <div className="mt-4">
      <div className="grid gap-3">
        <BillBar label="Current bill" tone="cost" value={currentBill} widthPct={100} />
        <BillBar label="With solar" tone="gain" value={withSolar} widthPct={solarPct} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">
        You&rsquo;d save about {formatMoney(values.monthlySavings)} a month
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
  tone: "cost" | "gain";
  value: number;
  widthPct: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>{label}</span>
        <span className="font-semibold text-ink">{formatMoney(value)}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${tone === "gain" ? "bg-gain" : "bg-cost"}`}
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
  const [loanRate, setLoanRate] = useState(DEFAULT_LOAN_RATE);
  const [loanTermYears, setLoanTermYears] = useState(DEFAULT_LOAN_TERM_YEARS);
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
  const scheduledLoanPayments = monthlyLoanPayment * loanTermYears * 12;
  const totalSolarPayments = downPaymentAmount + scheduledLoanPayments;
  const loanCosts = calculateTwentyYearSolarCosts({
    annualSavings: values.annualSavings,
    monthlyBill: values.monthlyBill,
    totalSolarPayments,
  });
  const selectedNetBenefit = financingMode === "lease"
    ? null
    : financingMode === "loan" ? loanCosts.totalSavings : values.twentyYearSavings;
  const hasNetLoss = selectedNetBenefit !== null && selectedNetBenefit < 0;
  const currentScenarioValue = financingMode === "loan"
    ? `${downPaymentPct}% down, ${loanRate.toFixed(1)}% APR, ${loanTermYears}-year term`
    : financingMode === "buy"
      ? `Cash purchase, ${formatMoney(values.netCostAfterCredit)} estimated net cost`
      : "Lease or PPA provider terms required; payments are not modeled";
  const financingRows = financingMode === "loan"
    ? [
        { label: "Down payment", source: "illustrative" as const, value: downPaymentAmount },
        {
          label: `Scheduled loan payments (${loanTermYears} years)`,
          source: "illustrative" as const,
          value: scheduledLoanPayments,
        },
        {
          label: `20-year cost with solar (includes full ${loanTermYears}-year loan)`,
          source: "illustrative" as const,
          value: loanCosts.totalCostWithSolar,
        },
        { label: "Total 20-year cost without solar", source: "modeled" as const, value: loanCosts.totalCostWithoutSolar },
        { label: "Total 20-year savings", source: "illustrative" as const, value: loanCosts.totalSavings },
      ]
    : values.financingRows;
  const financingAssumptions = [
    { label: "Current scenario", value: currentScenarioValue },
    ...(financingMode === "loan"
      ? [{
          label: "20-year comparison",
          value: `Includes the full ${loanTermYears}-year loan payment obligation`,
        }]
      : []),
    ...values.financingAssumptions,
  ];

  return (
    <div
      id="financing-calculator"
      className="grid scroll-mt-24 gap-4 lg:grid-cols-[0.95fr_1.05fr]"
    >
      <div className="rounded-card border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-sky-100/78">
              Financing comparison
            </p>
            <h3 className="mt-2 text-lg font-semibold text-ink">
              Illustrative financing scenarios
            </h3>
          </div>
          <span className="rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1.5 text-xs font-semibold text-amber-100">
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
              className={`min-h-11 rounded-full px-3 py-2 text-sm font-semibold ${
                financingMode === mode
                  ? "bg-ink text-night"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {mode === "buy" ? "Buy" : mode === "lease" ? "Lease" : "Loan"}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm leading-7 text-ink-muted">
          {financingCopy[financingMode]}
        </p>
        <p className="mt-3 text-xs leading-5 text-amber-100/78">
          Financing values are illustrative only. Final pricing, eligibility,
          incentives, APR, dealer fees, and terms require installer, lender, and
          tax-professional confirmation. No federal residential credit is assumed
          for new 2026 expenditures under current IRS guidance.
        </p>
        {financingMode === "loan" ? (
          <div className="mt-4 grid gap-3 rounded-card border border-white/10 bg-slate-950/35 p-3">
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
            <label className="grid gap-1 text-xs text-ink-dim">
              <span className="font-semibold">
                Term
              </span>
              <select
                aria-label="Term"
                value={loanTermYears}
                onChange={(event) => setLoanTermYears(Number(event.target.value))}
                className="rounded-full border border-white/12 bg-black/35 px-3 py-2 font-semibold text-ink outline-none"
              >
                {[10, 15, 20, 25].map((term) => (
                  <option key={term} value={term} className="bg-slate-950">
                    {term} years
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-card border border-white/8 bg-black/24 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">Monthly loan payment</span>
                <span className="font-semibold text-ink">
                  {formatMoney(monthlyLoanPayment)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-ink-dim">Monthly solar savings</span>
                <span className="font-semibold text-ink">
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
        <div
          aria-label="Current financing scenario"
          aria-live="polite"
          className="mt-4 rounded-card border border-sky-200/15 bg-sky-200/[0.06] p-3"
        >
          <p className="text-xs font-semibold text-sky-100/80">
            Current scenario
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            {formatMoney(values.monthlyBill)}/mo bill, {values.panelCount} panels ({values.recommendedKw.toFixed(1)} kW), {values.selectedPanel.brand} {values.selectedPanel.model}
          </p>
          <p className="mt-1 text-sm font-semibold leading-6 text-ink">
            {financingMode === "loan" ? "Loan: " : ""}{currentScenarioValue}
          </p>
        </div>
        <div className="mt-4 grid gap-2">
          {financingMode === "buy" ? (
            <>
              <MiniReadout label="System cost" source="illustrative" value={formatMoney(values.installedCost)} />
              <MiniReadout label="Modeled federal credit" source="illustrative" value={formatMoney(values.taxCredit)} />
              <MiniReadout label="Estimated net cost" source="illustrative" value={formatMoney(values.netCostAfterCredit)} />
              <MiniReadout
                label="Modeled payback"
                note="Estimated time for modeled savings to cover the current net system cost; it is not the loan term."
                source="modeled"
                value={formatPaybackYears(values.paybackYears)}
              />
            </>
          ) : null}
          {financingMode === "lease" ? <LeaseCalculator monthlySavings={values.monthlySavings} /> : null}
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
            label={hasNetLoss ? "20-year net loss" : "20-year net savings"}
            note={
              financingMode === "loan"
                ? `20-year comparison includes the full ${loanTermYears}-year loan payment obligation.`
                : hasNetLoss
                  ? "This option costs more than utility-only power under the current assumptions. Consider a smaller system or different financing."
                  : undefined
            }
            source="illustrative"
            value={
              selectedNetBenefit === null
                ? "Not modeled without provider terms"
                : formatMoney(selectedNetBenefit)
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
          className="min-h-11 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-ink-muted transition hover:bg-white/[0.1] hover:text-ink"
        >
          {showDetails ? "Hide assumptions and exclusions" : "View assumptions and exclusions"}
        </button>
        {showDetails ? (
          <div id="financing-assumptions" className="grid gap-4">
            {financingMode === "lease" ? (
              <p className="rounded-card border border-amber-200/15 bg-amber-300/8 p-4 text-sm leading-6 text-amber-50/80">
                A lease or PPA cannot be modeled responsibly without a provider
                price, escalator, term, buyout schedule, and production guarantee.
              </p>
            ) : (
              <EstimateTable rows={financingRows} />
            )}
            <AssumptionTable rows={financingAssumptions} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A lease or PPA payment replaces part of the bill, so the visitor enters the
 * quoted monthly price and sees what is left after paying it.
 */
function LeaseCalculator({ monthlySavings }: { monthlySavings: number }) {
  const [quote, setQuote] = useState("");
  const leasePrice = Number(quote);
  const hasQuote = quote.trim() !== "" && Number.isFinite(leasePrice) && leasePrice >= 0;
  const kept = monthlySavings - leasePrice;

  return (
    <div className="grid gap-3 rounded-control bg-night/60 p-3">
      <label className="block">
        <span className="field-label">Monthly price from your lease or PPA quote</span>
        <span className="mt-2 flex items-center gap-2">
          <span aria-hidden="true" className="text-ink-muted">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={quote}
            onChange={(event) => setQuote(event.target.value)}
            placeholder="e.g. 120"
            className="field-input"
          />
        </span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-control border border-ridge px-3 py-2.5">
          <p className="text-sm text-ink-muted">Bill savings before the lease payment</p>
          <p className="mt-1 text-lg font-semibold text-ink">{formatMoney(monthlySavings)}</p>
        </div>
        <div className="rounded-control border border-ridge px-3 py-2.5">
          <p className="text-sm text-ink-muted">What you keep each month</p>
          <p className={`mt-1 text-lg font-semibold ${hasQuote && kept < 0 ? "text-cost" : "text-ink"}`}>
            {hasQuote ? formatMoney(kept) : "Enter your quote"}
          </p>
        </div>
      </div>
      {hasQuote && kept < 0 ? (
        <p className="text-sm leading-6 text-ink-muted">
          The lease payment is more than the modeled bill savings, so this lease would cost you about{" "}
          {formatMoney(Math.abs(kept))} a month.
        </p>
      ) : null}
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
    <label className="block text-xs text-ink-dim">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="font-semibold text-ink">
          {value.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-sky-300"
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
        <div className="rounded-card border border-white/10 bg-black/20 p-5">
          <h3 className="text-xl font-semibold text-ink">Send My Full Report</h3>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            The quote request form is unavailable in this preview, but the report model is ready.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Where a number came from is explained once, in "How this estimate was
 * calculated". The only per-number marker kept is "Example", because an
 * illustrative figure (loan terms, lease pricing) must never read as a quote.
 */
function SourceBadge({ source }: { source: MetricSource }) {
  if (source !== "illustrative") {
    return null;
  }

  return (
    <span title="Example scenario only; not a quote or offer" className="tag shrink-0">
      Example
    </span>
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
    <div className="rounded-control bg-night/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        <SourceBadge source={source} />
      </div>
      <p className="mt-1 text-base font-semibold text-ink">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-ink-dim">{note}</p> : null}
    </div>
  );
}

function EstimateTable({
  rows,
}: {
  rows: Array<{ label: string; source: MetricSource; value: number }>;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-white/10 bg-black/20">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 border-b border-white/8 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <span className="flex flex-wrap items-center gap-2 text-sm text-ink-dim">
            {row.label}
            <SourceBadge source={row.source} />
          </span>
          <span className="text-base font-semibold text-ink">
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
    <div className="mt-4 overflow-hidden rounded-card border border-white/10 bg-black/20">
      <div className="border-b border-white/8 px-3 py-2">
        <p className="text-xs font-semibold text-ink-muted">
          Estimate assumptions
        </p>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 border-b border-white/8 px-3 py-2.5 last:border-b-0 sm:grid-cols-[1fr_auto]"
        >
          <span className="text-xs text-ink-dim">{row.label}</span>
          <span className="text-xs font-semibold text-ink">{row.value}</span>
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
  const panelAdjustedMetrics = getActiveEstimateMetrics(activeEstimate);
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
  const batteryCost = selectedBattery?.cost ?? 0;
  const upfrontAfterIncentives =
    financingMode === "buy" ? netCostAfterCredit : 0;
  const baselineLoanPayment = calculateMonthlyLoanPayment(
    installedCost,
    DEFAULT_LOAN_RATE,
    DEFAULT_LOAN_TERM_YEARS
  );
  const totalPayments =
    financingMode === "buy"
      ? upfrontAfterIncentives
      : financingMode === "lease"
        ? 0
        : baselineLoanPayment * DEFAULT_LOAN_TERM_YEARS * 12;
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
    costPerWatt: selectedPanel.installedCostPerWatt + inverterCostAdderPerWatt,
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
      { label: "Arizona electricity rate", value: `${azRatePerKwh.toFixed(3)}/kWh` },
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
      { label: "Fixed monthly charge", value: `${ARIZONA_FIXED_MONTHLY_CHARGE}/mo stays on the bill; demand charges are not modeled` },
      { label: "Production degradation", value: "Not modeled; installer production warranty required" },
      { label: "Export credit", value: `${ARIZONA_EXPORT_CREDIT_PER_KWH.toFixed(4)}/kWh (${ARIZONA_EXPORT_CREDIT_SOURCE.label})` },
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

function formatPaybackYears(value: number) {
  return Number.isFinite(value) && value > 0
    ? `${value.toFixed(1)} years`
    : "Not available";
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

/** "Good Candidate" -> "Good candidate", to match the sentence-case labels around it. */
function toSentenceCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
