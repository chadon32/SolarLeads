import { useMemo } from "react";
import { AC_OUTPUT_SOURCE, annualEnergyMatch, annualMatchLabel, readAnnualUsage } from "@/lib/annual-usage-match";
import type { RoofAnalysis } from "@/lib/roof-analysis";
import { getPanelFit, type SolarPanel } from "@/lib/solarPanels";

export type UsageMatchDraft = {
  usage: string;
  previous?: { count: number; moduleId: string; max: number };
};
const number = (value: number) => value.toLocaleString("en-US");

function LayoutMatch({ title, count, energy }: {
  title: string; count: number; energy: NonNullable<ReturnType<typeof annualEnergyMatch>>;
}) {
  return <div className="min-w-0 border-l-2 border-sky-200/40 pl-3">
    <dt className="text-sm font-semibold text-ink">{title} ({count} {count === 1 ? "panel" : "panels"})</dt>
    <dd className="mt-1">
      <strong className="text-xl text-sky-100">{annualMatchLabel(energy.percent)}</strong> of annual use
      <span className="mt-1 block text-sm text-ink-muted">{number(energy.acKwh)} kWh estimated AC output per year.</span>
      <span className="block text-sm text-ink-muted">{energy.gapKwh === 0 ? "Matches your annual total."
        : `${number(Math.abs(energy.gapKwh))} kWh ${energy.gapKwh < 0 ? "below" : "above"} your annual total.`}</span>
    </dd>
  </div>;
}

export function AnnualUsageMatch({ analysis, panel, currentCount, currentDc, maxCount, draft, onDraft, onApply }: {
  analysis: RoofAnalysis; panel: SolarPanel; currentCount: number; currentDc: number; maxCount: number;
  draft: UsageMatchDraft; onDraft: (draft: UsageMatchDraft) => void; onApply?: (count: number) => void;
}) {
  const usage = readAnnualUsage(draft.usage);
  const available = analysis.validSite && analysis.source === "solar-api" && currentCount > 0 && currentDc > 0 && Number.isFinite(currentDc);
  const needsMax = available && usage.kind === "valid" && maxCount > currentCount;
  const maxFit = useMemo(() => needsMax ? getPanelFit(panel, { roofData: analysis, selectedPanelCount: maxCount }) : null,
    [needsMax, analysis, panel, maxCount]);
  const current = available && usage.kind === "valid" ? annualEnergyMatch(currentDc, usage.kwh) : null;
  const maximum = maxFit && maxFit.maxPanelsFit === maxCount && usage.kind === "valid"
    ? annualEnergyMatch(maxFit.annualKwh, usage.kwh) : null;
  const previous = draft.previous;
  const restore = previous && previous.moduleId === panel.id && previous.max === maxCount && currentCount === maxCount
    && previous.count > 0 && previous.count < maxCount ? previous.count : null;
  return <section aria-labelledby="annual-use-heading" className="min-w-0 rounded-card border border-ridge bg-night/50 p-4 sm:p-5">
    <h3 id="annual-use-heading" className="text-lg font-semibold text-ink">Can my roof match my annual electricity use?</h3>
    {!available ? <p className="mt-2 text-sm text-ink-muted">A Solar API production estimate for the current layout is needed to compare it with your usage.</p> : <>
      <p id="annual-use-hint" className="mt-1 text-sm leading-6 text-ink-muted">Enter 12 months of total household use in kWh from your utility statement, not the dollar amount. Already have solar? Use whole-home consumption, not net grid purchases.</p>
      <label htmlFor="annual-use-kwh" className="field-label mt-3 block">Annual electricity use (kWh)</label>
      <input id="annual-use-kwh" type="text" inputMode="numeric" value={draft.usage} placeholder="e.g. 12,000"
        className="field-input mt-1 max-w-xs" aria-invalid={usage.kind === "invalid"}
        aria-describedby={usage.kind === "invalid" ? "annual-use-hint annual-use-error" : "annual-use-hint"}
        onChange={e => onDraft({ ...draft, usage: e.target.value })} />
      {usage.kind === "invalid" && <p id="annual-use-error" className="mt-1 text-sm text-rose-200">Enter a whole number from 1 to 1,000,000 kWh. Commas are optional.</p>}
      {current && <div aria-live="polite" aria-atomic="true" className="mt-4">
        <dl className="grid gap-4 text-sm text-ink sm:grid-cols-2">
          <LayoutMatch title="Current layout" count={currentCount} energy={current} />
          {maximum && <LayoutMatch title="Roof maximum" count={maxCount} energy={maximum} />}
        </dl>
        {currentCount === maxCount && <p className="mt-2 text-sm text-ink-muted">Your current layout already uses the modeled roof maximum for this module.</p>}
        {needsMax && !maximum && <p className="mt-2 text-sm text-ink-muted">Production at the roof maximum is unavailable.</p>}
      </div>}
      {onApply && (restore !== null || maximum) && <button type="button"
        className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ridge px-4 text-sm font-semibold text-ink hover:border-sky-200"
        onClick={() => {
          if (restore !== null) { onDraft({ usage: draft.usage }); onApply(restore); }
          else if (maximum) { onDraft({ ...draft, previous: { count: currentCount, moduleId: panel.id, max: maxCount } }); onApply(maxCount); }
        }}>{restore !== null ? `Restore previous layout (${restore} panels)` : `Try roof maximum (${maxCount} panels)`}</button>}
      {current && <p className="mt-3 text-sm text-ink-muted">An annual energy match does not mean a zero bill or round-the-clock solar power.</p>}
      <details className="mt-2 text-sm text-ink-muted">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-ink">How the comparison works</summary>
        <p className="leading-6">For this comparison, modeled panel output is multiplied by 85% to estimate usable AC energy, following the <a className="underline" href={AC_OUTPUT_SOURCE} target="_blank" rel="noreferrer">Google Solar API method</a>. Usage stays in this browser tab and clears on refresh. It does not change bill assumptions or go into your report. Trying a layout updates the panel count.</p>
      </details>
    </>}
  </section>;
}
