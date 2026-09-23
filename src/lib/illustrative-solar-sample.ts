/**
 * A deliberately generic, local-only report fixture for the first visit.
 *
 * This data is illustrative marketing content. It must never be derived from
 * a homeowner, a saved report, a coordinate, or a live solar provider call.
 */
export const ILLUSTRATIVE_SOLAR_SAMPLE = {
  label: "Illustrative sample",
  title: "A typical Arizona roof model",
  disclaimer: "Not your home, not a quote, and not an installation design.",
  systemRange: "5.6–6.8 kW",
  productionRange: "8,400–10,100 kWh / year",
  savingsRange: "$1,400–$1,800 / year",
  factors: [
    {
      title: "Roof shape",
      copy: "Usable roof planes and obstructions change how many panels may fit.",
    },
    {
      title: "Sun exposure",
      copy: "Orientation and shade affect modeled production throughout the year.",
    },
    {
      title: "Electricity use",
      copy: "Your bill and utility plan change the savings range and system target.",
    },
  ],
} as const;
