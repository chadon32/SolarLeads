import type { BatteryOption } from "@/lib/batteries";
import { DEFAULT_BACKUP_SCENARIO, estimateBatteryRuntime, readRunningWatts, runtimeLabel, type BackupScenario } from "@/lib/battery-runtime";

export function BatteryRuntimePlanner({ battery, scenario, onChange }: {
  battery: BatteryOption;
  scenario: BackupScenario;
  onChange: (draft: BackupScenario) => void;
}) {
  const watts = readRunningWatts(scenario.load);
  const invalid = scenario.load.trim() !== "" && watts === null;
  const result = estimateBatteryRuntime(battery, scenario);
  const name = `${battery.brand} ${battery.model}`;
  return (
    <section aria-labelledby="backup-scenario-heading" className="mt-4 rounded-card border border-ridge bg-night/50 p-4">
      <h5 id="backup-scenario-heading" className="text-base font-semibold text-ink">How long could one battery last?</h5>
      <p id="backup-load-help" className="mt-1 text-sm leading-6 text-ink-muted">
        Add the running watts of the devices you want to use at the same time. For example, 300 W plus 200 W is a 500 W load.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="field-label">Total running load (W)
          <input type="text" inputMode="numeric" maxLength={16} autoComplete="off" value={scenario.load}
            className="field-input mt-1.5 min-h-11" aria-invalid={invalid}
            aria-describedby={invalid ? "backup-load-help backup-load-error" : "backup-load-help"}
            onChange={e => onChange({ ...scenario, load: e.target.value })} />
        </label>
        <label className="field-label">Charge at start of outage
          <select className="field-input mt-1.5 min-h-11" value={scenario.charge}
            onChange={e => onChange({ ...scenario, charge: Number(e.target.value) })}>
            {[25, 50, 75, 100].map(p => <option value={p} key={p}>{p}%</option>)}
          </select>
        </label>
      </div>
      {invalid && <p id="backup-load-error" className="mt-2 text-sm text-amber-100">Enter a positive whole number of watts, such as 1,500.</p>}
      <p aria-live="polite" aria-atomic="true" className="mt-3 text-sm font-semibold text-sky-100">
        {result.kind === "invalid" ? "Enter a valid load to see a runtime."
          : result.kind === "over-limit" ? `This load exceeds the modeled ${battery.powerKw} kW continuous output of one ${name}. No runtime is estimated.`
          : `${name}: ${runtimeLabel(result)} estimated at ${result.watts.toLocaleString("en-US")} W and ${scenario.charge}% starting charge.`}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        Energy-only estimate: starting energy divided by a steady load, with no solar recharge. Reserve settings, losses, temperature and startup surges can shorten runtime or prevent a device from starting. Confirm your backed-up circuits and installed output with your installer.
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">These two inputs do not change your price, savings or report.</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        <a href={battery.specificationUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm font-medium text-sky-200 underline">Specifications for {name} (PDF)</a>
        <button type="button" onClick={() => onChange(DEFAULT_BACKUP_SCENARIO)}
          className="min-h-11 text-sm font-semibold text-ink underline">Reset runtime inputs</button>
      </div>
    </section>
  );
}
