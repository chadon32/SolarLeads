const topics = [
  ["roof", "Roof condition and usable space", "Which roof sections, obstructions, setbacks, or repairs would change my proposed layout?"],
  ["electrical", "Electrical service capacity and utility approval", "Does my electrical service need upgrades, and what steps does my utility require before connecting?"],
  ["production", "Sunlight and expected production", "What first-year production in kWh do you expect after shade and other losses? Which assumptions differ from this preliminary model?"],
  ["bill", "Bill savings and export credits", "Which utility plan, fixed charges, and export credits did you use to estimate my bill after solar?"],
  ["equipment", "Equipment, warranties, and final price", "Can I get the equipment models, warranties, and itemized cash price in writing, with storage and roof work shown separately?"],
] as const;

export type VisitTopicId = (typeof topics)[number][0];

export function InstallerVisitAgenda({ selected, onChange }: {
  selected: VisitTopicId[];
  onChange: (topics: VisitTopicId[]) => void;
}) {
  const questions = topics.filter(([id]) => selected.includes(id));
  const summary = `${questions.length} of ${topics.length} topics selected`;
  const agenda = [
    "SolarTelligence | My installer site visit", "",
    ...questions.map(([, label, question], i) => `${i + 1}. ${label}\n${question}\n`),
    "Discussion guide only. An on-site professional must verify the installation requirements.",
  ].join("\n");
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
      </>}
      <p className="mt-2 text-xs leading-5 text-ink-dim">Your selections clear when you refresh or leave this estimate. The download includes no address or contact details.</p>
    </section>
  );
}
