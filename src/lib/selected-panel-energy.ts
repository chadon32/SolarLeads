import type { RoofAnalysis } from "@/lib/roof-analysis";
import { selectCohesiveSolarPanels } from "@/lib/panel-layout";

/** Use the same physical cohort as the 3D view, not a nearby full-system config. */
export function getSelectedPanelEnergy(
  analysis: RoofAnalysis,
  panelCount: number,
  dimensions = { widthMeters: analysis.panelWidthMeters, heightMeters: analysis.panelHeightMeters }
) {
  const count = Number.isFinite(panelCount) ? Math.max(0, Math.floor(panelCount)) : 0;
  if (!count) return 0;
  const panels = selectCohesiveSolarPanels({
    panels: analysis.solarPanels,
    targetCount: count,
    panelWidthMeters: dimensions.widthMeters,
    panelHeightMeters: dimensions.heightMeters,
  });
  if (panels.length === count && panels.every((panel) =>
    Number.isFinite(panel.yearlyEnergyDcKwh) && panel.yearlyEnergyDcKwh >= 0
  )) {
    return panels.reduce((sum, panel) => sum + panel.yearlyEnergyDcKwh, 0);
  }

  // Missing per-panel data: interpolate sparse aggregate configurations.
  const configs = analysis.solarPanelConfigs
    .filter((config) => config.panelsCount > 0 && Number.isFinite(config.yearlyEnergyDcKwh) && config.yearlyEnergyDcKwh >= 0)
    .toSorted((a, b) => a.panelsCount - b.panelsCount);
  const upper = configs.find((config) => config.panelsCount >= count);
  const lower = configs.findLast((config) => config.panelsCount <= count);
  if (lower?.panelsCount === count) return lower.yearlyEnergyDcKwh;
  if (upper) {
    const lowCount = lower?.panelsCount ?? 0;
    const lowEnergy = lower?.yearlyEnergyDcKwh ?? 0;
    return lowEnergy + (upper.yearlyEnergyDcKwh - lowEnergy) *
      (count - lowCount) / (upper.panelsCount - lowCount);
  }
  const reference = lower ?? { panelsCount: analysis.panelCount, yearlyEnergyDcKwh: analysis.annualKwh };
  return reference.panelsCount > 0 && Number.isFinite(reference.yearlyEnergyDcKwh)
    ? Math.max(0, reference.yearlyEnergyDcKwh / reference.panelsCount * count)
    : 0;
}
