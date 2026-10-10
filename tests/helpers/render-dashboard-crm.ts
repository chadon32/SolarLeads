// Renders the dashboard with two synthetic leads to static HTML. Run in a
// separate process: react-dom/server is unavailable under the react-server
// condition the unit tests use.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DashboardCrm,
  type DashboardCrmLead,
} from "../../src/components/dashboard-crm";
import { normalizeDashboardView } from "../../src/lib/dashboard-analytics";

const lead = (id: string, name: string, address: string): DashboardCrmLead => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.test`,
  phone: "",
  address,
  monthlyBill: 200,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: null,
  modelCreatedAt: null,
  modelVersion: null,
  dataQuality: "complete",
  annualSavings: 2_000,
  co2OffsetLbs: null,
  estimatedRoiYears: 8,
  energyOffsetPct: 80,
  panelCount: 20,
  federalTaxCredit: null,
  netSystemCost: null,
  selectedInverterType: null,
  selectedPanelBrand: "Qcells",
  selectedPanelModel: "Q.PEAK",
  selectedPanelWatts: 400,
  systemCostBeforeIncentives: null,
  systemSizeKw: 8,
  leadScore: 70,
  leadScoreExplanation: "",
  leadScoreLabel: null,
  reportUrl: "",
  status: "new",
  pdfStatus: "ready",
  utilityBillUploaded: false,
  batteryAdded: false,
  batteryBrand: null,
  batteryModel: null,
  batteryCost: null,
  referralCode: null,
  referredBy: null,
  referralsMade: 0,
});

const stats = {
  totalLeads: 2,
  averageSavings: null,
  averageLeadScore: null,
  queuedFollowUps: null,
  pdfsGenerated: null,
  averagePayback: null,
  conversionRate: null,
  totalPipelineValue: null,
  lastUpdatedAt: null,
  loadedAt: "2026-10-05T12:00:00.000Z",
};

process.stdout.write(
  renderToStaticMarkup(
    createElement(DashboardCrm, {
      leads: [
        lead(
          "00000000-0000-4000-8000-0000000000a1",
          "Avery",
          "1 Test Way, Mesa, AZ 85201",
        ),
        lead(
          "00000000-0000-4000-8000-0000000000b2",
          "Blake",
          "2 Test Way, Mesa, AZ 85201",
        ),
      ],
      followUps: [],
      stats,
      initialView: process.argv[2]
        ? normalizeDashboardView(process.argv[2])
        : "pipeline",
    }),
  ),
);
