import { siteVisitCalendar, VISIT_DURATIONS, type VisitSchedule } from "@/lib/site-visit-calendar";

const topics = [
  ["roof", "Roof condition and usable space", "Which roof sections, obstructions, setbacks, or repairs would change my proposed layout?"],
  ["electrical", "Electrical service capacity and utility approval", "Does my electrical service need upgrades, and what steps does my utility require before connecting?"],
  ["production", "Sunlight and expected production", "What first-year production in kWh do you expect after shade and other losses? Which assumptions differ from this preliminary model?"],
  ["bill", "Bill savings and export credits", "Which utility plan, fixed charges, and export credits did you use to estimate my bill after solar?"],
  ["equipment", "Equipment, warranties, and final price", "Can I get the equipment models, warranties, and itemized cash price in writing, with storage and roof work shown separately?"],
] as const;

export type VisitTopicId = (typeof topics)[number][0];
export type VisitCalendarDraft = VisitSchedule & { file?: { id: string; created: string } };

export function InstallerVisitAgenda({ selected, onChange, schedule, onSchedule }: {
  selected: VisitTopicId[];
  onChange: (topics: VisitTopicId[]) => void;
  schedule: VisitCalendarDraft;
  onSchedule: (schedule: VisitCalendarDraft) => void;
}) {
  const questions = topics.filter(([id]) => selected.includes(id));
  const summary = `${questions.length} of ${topics.length} topics selected`;
  const agenda = [
    "SolarTelligence | My installer site visit", "",
    ...questions.map(([, label, question], i) => `${i + 1}. ${label}\n${question}\n`),
    "Discussion guide only. An on-site professional must verify the installation requirements.",
  ].join("\n");
  const calendar = questions.length && schedule.file
    ? siteVisitCalendar(schedule, agenda, schedule.file.id, new Date(schedule.file.created)) : null;
  function editSchedule(change: Partial<VisitSchedule>) {
    const id = schedule.file?.id ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
    onSchedule({ ...schedule, ...change, file: { id, created: new Date().toISOString() } });
  }
  const fieldClass = "mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-ridge bg-night px-2 text-sm text-ink [color-scheme:dark]";
  return (
    <section aria-labelledby="visit-checklist-heading" className="mt-4 rounded-card border border-ridge bg-night/50 p-4">
      <h3 id="visit-checklist-heading" className="text-base font-semibold text-ink">Installer verification checklist</h3>
      <p className="mt-1 text-sm leading-6 text-ink-muted">Choose questions for your on-site installer review. Selecting a topic does not verify it or change your estimate.</p>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-ink">My site visit topics</legend>
        {topics.map(([id, label]) => (
          <label key={id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-ridge py-2 text-sm text-ink">
            <input type="checkbox" className="size-5 shrink-0 accent-sky-300" checked={selected.includes(id)}
              onChange={e => onChange(e.target.checked ? [...selected, id] : selected.filter(item => item !== id))} />
            {label}
          </label>
        ))}
      </fieldset>
      <p role="status" className="mt-3 text-sm font-semibold text-sky-100">{summary}</p>
      {questions.length > 0 && <>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-muted">
          {questions.map(([id, , question]) => <li key={id}>{question}</li>)}
        </ol>
        <a download="SolarTelligence-site-visit.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(agenda)}`}
          className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ridge px-4 text-sm font-semibold text-ink hover:border-sky-200">
          Download site visit agenda
        </a>
        <details className="mt-3 border-t border-ridge">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">Add this agenda to my calendar</summary>
          <p className="text-sm leading-6 text-ink-muted">For a visit you have already arranged. The file includes your selected questions. It does not book a visit or send an invitation.</p>
          <fieldset className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <legend className="sr-only">Site visit date, start time and duration</legend>
            <label className="min-w-0 text-sm text-ink">Visit date
              <input type="date" min="2000-01-01" max="9998-12-31" className={fieldClass} value={schedule.date} onChange={e => editSchedule({ date: e.target.value })} />
            </label>
            <label className="min-w-0 text-sm text-ink">Start time (Phoenix)
              <input type="time" className={fieldClass} value={schedule.time} onChange={e => editSchedule({ time: e.target.value })} />
            </label>
            <label className="min-w-0 text-sm text-ink">Visit length
              <select className={fieldClass} value={schedule.minutes} onChange={e => editSchedule({ minutes: Number(e.target.value) })}>
                {VISIT_DURATIONS.map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </label>
          </fieldset>
          <p className="mt-2 text-xs leading-5 text-ink-muted">Enter the time in Phoenix (UTC-7). Your calendar will display the equivalent time in its own time zone.</p>
          {calendar ? <a download="SolarTelligence-site-visit.ics" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendar)}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ridge px-4 text-sm font-semibold text-ink hover:border-sky-200">
            Download calendar file (.ics)
          </a> : <p className="mt-2 text-sm text-ink-muted">Choose a valid date and start time to download the calendar file.</p>}
        </details>
      </>}
      <p className="mt-2 text-xs leading-5 text-ink-dim">Your visit details clear when you refresh or leave this estimate. Neither download includes your address or contact details.</p>
    </section>
  );
}
