import { useId, useRef, useState } from "react";
import { BILL_MONTHS, calculateBillAverage, MAX_MONTHLY_BILL } from "@/lib/bill-average";

type Props = { currentBill: number; onApply: (amount: number) => void };
const money = (value: number) => "$" + value.toLocaleString("en-US");

export function BillAverageCalculator({ currentBill, onApply }: Props) {
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <div className="text-left">
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={id}
        className="min-h-11 text-sm font-semibold text-sky-200 underline decoration-sky-200/40 underline-offset-4"
        onClick={() => { setApplied(null); setOpen(!open); }}>
        Calculate my monthly average
      </button>
      <div id={id} hidden={!open}>
        {open && <BillHistoryEditor onCancel={close} onApply={amount => {
          onApply(amount);
          setApplied(amount);
          close();
        }} />}
      </div>
      <span aria-live="polite" aria-atomic="true" className="block text-sm text-ink-muted">
        {!open && applied !== null && applied === currentBill ? `Estimate now uses ${money(applied)} per month.` : ""}
      </span>
    </div>
  );
}

function BillHistoryEditor({ onApply, onCancel }: { onApply: Props["onApply"]; onCancel: () => void }) {
  const id = useId();
  const [mode, setMode] = useState<"annual" | "months">("annual");
  const [annualTotal, setAnnualTotal] = useState("");
  const [months, setMonths] = useState<string[]>(() => BILL_MONTHS.map(() => ""));
  const annual = mode === "annual";
  const result = calculateBillAverage(annual ? { annualTotal } : { months });
  const summary = result.problem === "invalid" ? "Check the marked amounts. Use dollars and up to two decimal places."
    : result.problem === "range" ? `The estimate supports a monthly average from $1 to ${money(MAX_MONTHLY_BILL)}.`
    : result.problem === "incomplete" ? (annual ? "Enter the total from 12 months of bills." : "Enter at least two months to see an average.")
    : `${money(result.monthlyBill!)} per month, rounded from ${result.count} months.${result.count < 12 ? " Partial year: seasonal bills may change this average." : ""}`;
  return (
    <section aria-label="Bill history calculator" className="mb-3 rounded-card border border-ridge bg-night/60 p-4">
      <fieldset>
        <legend className="text-base font-semibold text-ink">Which figures do you have?</legend>
        <div className="mt-1 flex flex-wrap gap-x-5">
          {([["annual", "12-month total"], ["months", "Individual bills"]] as const).map(([value, label]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="radio" name={id} checked={mode === value} onChange={() => setMode(value)} />{label}
            </label>
          ))}
        </div>
      </fieldset>
      <p id={id + "-help"} className="mb-3 text-sm leading-6 text-ink-muted">{annual
        ? "Use electricity charges for the full 12 months, not your current account balance."
        : "Use bills from the last 12 months. Leave missing months blank; enter 0 only if that month's charge was zero."}</p>
      <div className={annual ? "" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}>
        {(annual ? ["12-month electricity total"] : BILL_MONTHS).map((label, index) => {
          const bad = result.invalid.includes(index);
          const errorId = id + "-error-" + index;
          return <div key={label}>
            <label className="block text-sm text-ink">{label} ($)
              <input type="text" inputMode="decimal" autoComplete="off" maxLength={20} className="field-input mt-1 min-h-11"
                placeholder={annual ? "e.g. 2,400" : "Amount"} value={annual ? annualTotal : months[index]}
                aria-invalid={bad} aria-describedby={id + "-help" + (bad ? " " + errorId : "")}
                onChange={event => {
                  const value = event.target.value;
                  if (annual) setAnnualTotal(value);
                  else setMonths(previous => previous.map((old, i) => i === index ? value : old));
                }} />
            </label>
            {bad && <p id={errorId} className="mt-1 text-xs text-amber-100">Enter a nonnegative amount, for example 125.50.</p>}
          </div>;
        })}
      </div>
      <p role="status" className="mt-4 text-sm font-semibold text-ink">{summary}</p>
      <p className="mt-1 text-xs leading-5 text-ink-dim">Only the average is applied to your estimate. Closing this calculator clears the amounts you entered.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary min-h-11" disabled={result.monthlyBill === null}
          onClick={() => { if (result.monthlyBill !== null) onApply(result.monthlyBill); }}>Use this average</button>
        <button type="button" className="btn btn-quiet min-h-11" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
