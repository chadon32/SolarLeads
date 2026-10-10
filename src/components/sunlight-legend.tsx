import { SUNLIGHT_RAMP_FLOOR, sunlightRampGradientCss } from "@/lib/sunlight-heatmap";

/**
 * Legend for the annual-flux heatmap (2D map and 3D roof). Colours show each
 * spot's share of this roof's best-case sun, not a stretch across whatever
 * values happen to be on screen.
 */
export function SunlightLegend({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const floor = Math.round(SUNLIGHT_RAMP_FLOOR * 100);
  return (
    <div
      role="img"
      aria-label={`Sunlight colours: each spot's share of this roof's best-case sun, from ${floor} percent or less in blue to 100 percent in orange.`}
      className="grid gap-1"
    >
      <span aria-hidden="true" className="block h-2 w-full rounded-full" style={{ backgroundImage: sunlightRampGradientCss() }} />
      <span aria-hidden="true" className={`flex justify-between gap-2 text-xs leading-3 ${tone === "dark" ? "text-slate-300" : "text-slate-600"}`}>
        <span>≤{floor}%</span>
        <span>of best-case sun</span>
        <span>100%</span>
      </span>
    </div>
  );
}
