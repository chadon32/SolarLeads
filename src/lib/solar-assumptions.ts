// Rounded from EIA's April 2026 Arizona residential average of 15.48 cents/kWh.
export const ARIZONA_AVG_RATE_PER_KWH = 0.155;
export const ARIZONA_AVG_ANNUAL_HOME_KWH = 14_000;
export const STANDARD_PANEL_WATTS = 400;

/**
 * Arizona cash-installation benchmark, including equipment and installation.
 * It is a market planning assumption, not a panel MSRP or installer quote.
 */
export const ARIZONA_INSTALLED_COST_MARKET = {
  asOf: "2026-07-24",
  averagePerWatt: 2.3,
  highPerWatt: 2.65,
  lowPerWatt: 1.96,
  sourceLabel: "EnergySage Arizona marketplace",
  sourceUrl: "https://www.energysage.com/local-data/solar-panel-cost/az/",
} as const;

export const INSTALLED_COST_PER_WATT =
  ARIZONA_INSTALLED_COST_MARKET.averagePerWatt;
