// Rounded from EIA's April 2026 Arizona residential average of 15.48 cents/kWh.
export const ARIZONA_AVG_RATE_PER_KWH = 0.155;
export const ARIZONA_AVG_ANNUAL_HOME_KWH = 14_000;

/**
 * Monthly charge solar cannot remove: APS's residential basic service charge
 * of $0.468/day (Saver Choice Plus tariff), about $14 a month. SRP and TEP
 * charges differ; this keeps the estimate from ever showing a $0 bill.
 */
export const ARIZONA_FIXED_MONTHLY_CHARGE = 14;

/**
 * Credit for solar power sent back to the grid: APS Resource Comparison Proxy,
 * tranche 2026 (interconnections 2026-09-01 to 2027-08-31). It steps down
 * about 10% each September; SRP's export credit is lower.
 */
export const ARIZONA_EXPORT_CREDIT_PER_KWH = 0.05554;
export const ARIZONA_EXPORT_CREDIT_SOURCE = {
  label: "APS RCP export rate, 2026 tranche",
  url: "https://www.aps.com/-/media/APS/APSCOM-PDFs/Utility/Regulatory-and-Legal/Regulatory-Plan-Details-Tariffs/Residential/Renewable-Plans-and-Riders/rcp_RateSchedule.ashx",
} as const;

/**
 * Share of solar production a home uses as it is generated, without a
 * battery. Planning assumption inside published 25-45% ranges; Arizona's
 * daytime cooling load puts homes toward the upper end.
 */
export const SOLAR_SELF_CONSUMPTION_SHARE = 0.4;
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
