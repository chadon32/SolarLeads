import { useRef, type RefObject } from "react";
import { buildInstallerMeetingBrief, compareCashOffers, compareInstallerQuote, readCashQuote, type CashQuoteDraft } from "@/lib/installer-quote-comparison";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const card = "min-w-0 rounded-card border border-ridge bg-night/50 p-4 sm:p-5";
const action = "min-h-11 rounded-full border border-ridge px-4 text-sm font-semibold text-ink hover:border-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200";

export type EstimateSnapshot = {
  module: string;
  inverter: string;
  battery: string;
  monthlyBill: number;
  panelCount: number;
  systemKw: number;
  installedCost: number;
  annualSavings: number;
};

export function ScenarioComparison({ current, baseline, onPin }: {
  current: EstimateSnapshot;
  baseline: EstimateSnapshot | null;
  onPin: (value: EstimateSnapshot | null) => void;
}) {
  const pinButton = useRef<HTMLButtonElement>(null);
  const delta = baseline ? Math.round(current.annualSavings) - Math.round(baseline.annualSavings) : 0;
  const rows: [string, (s: EstimateSnapshot) => string][] = [
    ["Panel layout", s => `${s.panelCount} panels / ${s.systemKw.toFixed(1)} kW`],
    ["Panel model", s => s.module],
    ["Inverter", s => s.inverter],
    ["Battery", s => s.battery],
    ["Monthly bill", s => dollars.format(s.monthlyBill)],
    ["Installed cost before incentives", s => dollars.format(s.installedCost)],
    ["First-year bill savings", s => dollars.format(s.annualSavings)],
  ];
  const identical = baseline !== null && rows.every(([, show]) => show(baseline) === show(current));
  return (
    <section aria-labelledby="compare-setups-heading" className={card}>
      <h3 id="compare-setups-heading" className="text-lg font-semibold text-ink">Compare two setups</h3>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        Pin this estimate, then change your bill, panel layout, or equipment. Return here to see what changed.
        The baseline stays with this roof until you refresh or leave the estimate.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={pinButton} type="button" className={action} onClick={() => onPin({ ...current })}>
          {baseline ? "Replace baseline with current" : "Pin current setup"}
        </button>
        {baseline && <button type="button" className={action} onClick={() => {
          onPin(null);
          pinButton.current?.focus();
        }}>Clear baseline</button>}
      </div>
      <p role="status" className="mt-2 text-sm font-semibold text-sky-100">
        {!baseline ? "No baseline pinned." : identical ? "Current setup matches your baseline."
          : delta === 0 ? "The setup changed. Estimated first-year bill savings are unchanged."
          : `With the current setup, estimated first-year bill savings are ${dollars.format(Math.abs(delta))} ${delta > 0 ? "higher" : "lower"}.`}
      </p>
      {baseline && (
        <table className="mt-3 w-full table-fixed border-collapse text-left text-xs leading-5 text-ink sm:text-sm">
          <caption className="sr-only">Pinned baseline and current estimate for this roof</caption>
          <thead className="text-ink-muted"><tr>
            {["Measure", "Baseline", "Current"].map(label => <th key={label} scope="col" className="px-1.5 py-2">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map(([label, show]) => (
            <tr key={label} className="border-t border-ridge">
              <th scope="row" className="break-words px-1.5 py-2 align-top font-medium">{label}</th>
              <td className="break-words px-1.5 py-2 align-top text-ink-muted">{show(baseline)}</td>
              <td className="break-words px-1.5 py-2 align-top">
                {show(current) !== show(baseline) ? <strong>{show(current)}</strong> : show(current)}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

function CashQuoteFields({ draft, onChange, prefix, priceRef }: {
  draft: CashQuoteDraft;
  onChange: (value: CashQuoteDraft) => void;
  prefix: string;
  priceRef?: RefObject<HTMLInputElement | null>;
}) {
  const { invalidPrice, invalidSize } = readCashQuote(draft);
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {([
        ["price", "Quoted cash price ($)", "e.g. 24,000", invalidPrice, "Enter a price greater than zero, such as 24,000."],
        ["size", "Quoted system size (kW DC)", "e.g. 8.4", invalidSize, "Enter a size greater than zero in kW, such as 8.4."],
      ] as const).map(([key, label, placeholder, invalid, error]) => (
        <div key={key} className="min-w-0">
          <label className="field-label" htmlFor={`${prefix}-${key}`}>{label}</label>
          <input id={`${prefix}-${key}`} type="text" inputMode="decimal" autoComplete="off" maxLength={24}
            ref={key === "price" ? priceRef : undefined}
            placeholder={placeholder} value={draft[key]} aria-invalid={invalid}
            aria-describedby={invalid ? `${prefix}-${key}-error ${prefix}-help` : `${prefix}-help`}
            className="field-input mt-1.5 min-h-11"
            onChange={event => onChange({ ...draft, [key]: event.target.value })} />
          {invalid && <p id={`${prefix}-${key}-error`} className="mt-1 text-sm text-amber-100">{error}</p>}
        </div>
      ))}
    </div>
  );
}

export function InstallerQuoteComparison({ draft, second, modelRate, modeledWatts, onChange, onSecondChange }: {
  draft: CashQuoteDraft;
  second: CashQuoteDraft | null;
  onSecondChange: (value: CashQuoteDraft | null) => void;
  modelRate: number;
  modeledWatts: number;
  onChange: (value: CashQuoteDraft) => void;
}) {
  const priceInput = useRef<HTMLInputElement>(null);
  const { comparison } = compareInstallerQuote(draft, modelRate);
  const offers = second && compareCashOffers(draft, second);
  const brief = comparison ? buildInstallerMeetingBrief(comparison, modelRate, modeledWatts) : null;
  return (
    <section aria-labelledby="cash-quote-heading" className={`mt-4 ${card}`}>
      <h4 id="cash-quote-heading" className="text-base font-semibold text-ink">Check an installer&apos;s cash quote</h4>
      <p id="cash-quote-help" className="mt-1 text-sm leading-6 text-ink-muted">
        Use the solar-only price before incentives. Exclude batteries, roof work, and financing fees.
        These inputs stay in this estimate and are not sent with your report.
      </p>
      <fieldset className="mt-3 min-w-0">
        <legend className={second ? "text-sm font-semibold text-ink" : "sr-only"}>Quote A</legend>
        <CashQuoteFields draft={draft} onChange={onChange} prefix="cash-quote" priceRef={priceInput} />
      </fieldset>
      <div className="mt-3 border-t border-ridge pt-3 text-sm leading-6">
        <p className="text-ink-muted">Modeled solar-only price: <strong className="text-ink">${modelRate.toFixed(2)}/W</strong></p>
        <p role="status" className="font-semibold text-sky-100">
          {comparison
            ? `Your quote: $${comparison.quotePerWatt.toFixed(2)}/W. ${comparison.deltaPerWatt === 0
              ? "Matches the estimate to the nearest cent per watt."
              : `$${Math.abs(comparison.deltaPerWatt).toFixed(2)}/W ${comparison.deltaPerWatt > 0 ? "above" : "below"} the estimate.`}`
            : "Enter both amounts to compare prices per watt."}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-dim">Price per watt accounts for different system sizes, not differences in production, equipment, or warranties.</p>
      </div>
      {brief && <details className="mt-3 rounded-card border border-ridge p-3">
        <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-ink">Prepare my installer meeting brief</summary>
        <p className="mb-2 text-xs leading-5 text-ink-muted">Save these numbers and questions for your call. No address or contact details are included.</p>
        <p className="select-text whitespace-pre-line break-words text-sm leading-6 text-ink">{brief}</p>
        <a className={`mt-3 inline-flex items-center ${action}`} download="SolarTelligence-installer-brief.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(brief)}`}>Download brief (.txt)</a>
      </details>}
      {(draft.price || draft.size) && <button type="button" className={`mt-3 ${action}`} onClick={() => {
        onChange({ price: "", size: "" });
        priceInput.current?.focus();
      }}>{second ? "Clear quote A" : "Clear quote"}</button>}
      <div className="mt-4 border-t border-ridge pt-3">
        <button type="button" className={action} aria-expanded={second !== null} aria-controls="second-offer"
          onClick={() => onSecondChange(second ? null : { price: "", size: "" })}>
          {second ? "Remove quote B" : "Compare a second cash quote"}
        </button>
        <div id="second-offer" hidden={!second}>
          {second && <>
            <fieldset className="mt-4 min-w-0">
              <legend className="text-sm font-semibold text-ink">Quote B</legend>
              <p id="cash-quote-b-help" className="mt-1 text-sm leading-6 text-ink-muted">
                Use the same scope as quote A: solar only, before incentives. Leave out financing, batteries and roof work.
              </p>
              <CashQuoteFields draft={second} onChange={onSecondChange} prefix="cash-quote-b" />
            </fieldset>
            <p aria-live="polite" aria-atomic="true" className="mt-4 text-sm font-semibold text-sky-100">
              {offers?.summary ?? "Enter a valid cash price and system size for both quotes to compare them."}
            </p>
            {offers && <>
              <table className="mt-3 w-full table-fixed text-left text-sm text-ink">
                <caption className="sr-only">Installer cash offers side by side</caption>
                <thead><tr>{["Measure", "Quote A", "Quote B"].map(h => <th className="py-2" key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{offers.rows.map(([label, a, b]) => <tr key={label} className="border-t border-ridge">
                  <th className="py-2 pr-1 font-medium" scope="row">{label}</th>
                  <td className="break-words pr-1">{a}</td><td className="break-words">{b}</td>
                </tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs leading-5 text-ink-muted">{offers.note}</p>
              <a download="SolarTelligence-cash-offers.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(offers.text)}`}
                className={`mt-3 inline-flex items-center ${action}`}>Download quote comparison</a>
            </>}
            <p className="mt-2 text-xs leading-5 text-ink-dim">Both quotes clear on refresh. The comparison download contains no address or contact details.</p>
          </>}
        </div>
      </div>
    </section>
  );
}
