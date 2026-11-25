import { roofFaceTitle } from "@/lib/roof-face-labels";
import type { ListedRoofSection } from "@/lib/roof-section-explorer";

const squareFeet = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function RoofSectionExplorer({ sections, panelsVisible, selectedId, onSelect }: {
  sections: ListedRoofSection[];
  panelsVisible?: boolean;
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
}) {
  if (!sections.length) return null;
  return (
    <details className="border-t border-white/15 bg-slate-950 px-4 text-slate-100">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-200">
        Explore roof sections ({sections.length})
      </summary>
      <p className="pb-3 text-sm leading-6 text-slate-300">
        {onSelect ? "Choose a section to highlight it on the 3D roof. Choose it again to clear the highlight."
          : "The 3D view is unavailable. These section estimates come from the roof analysis; there is no rendered panel layout to inspect."}
        {" "}Area is estimated roof surface, not space approved for panels.
      </p>
      <ul aria-label="Roof sections" className="grid gap-2 pb-4 sm:grid-cols-2">
        {sections.map((s, i) => {
          const selected = selectedId === s.id;
          const name = `Section ${i + 1}: ${roofFaceTitle(s.pitchDeg, s.azimuthDeg)}`;
          return <li key={s.id} className={`min-w-0 rounded-card border px-3 py-2 ${selected ? "border-sky-300 bg-sky-950/60" : "border-white/15 bg-white/[0.03]"}`}>
            {onSelect ? <button type="button" aria-pressed={selected} onClick={() => onSelect(selected ? null : s.id)}
              className="min-h-11 w-full text-left text-sm font-semibold text-sky-200 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-sky-200">
              {name}
            </button> : <p className="py-1 text-sm font-semibold">{name}</p>}
            <dl className="grid grid-cols-2 gap-x-2 gap-y-2 pb-1 text-xs leading-5">
              <div><dt className="text-slate-400">Roof area</dt><dd>{squareFeet.format(s.areaM2 / 0.09290304)} sq ft</dd></div>
              <div><dt className="text-slate-400">Pitch</dt><dd>{Math.round(s.pitchDeg)}°</dd></div>
              {onSelect && <>
                <div><dt className="text-slate-400">Relative sunlight</dt><dd>{s.sunShare !== null && Number.isFinite(s.sunShare) ? `${Math.round(s.sunShare * 100)}% of best-case sun` : "Not available"}</dd></div>
                <div><dt className="text-slate-400">Panels shown</dt><dd>{!panelsVisible ? "Layer hidden" : s.moduleCount ?? "Not available"}</dd></div>
              </>}
            </dl>
          </li>;
        })}
      </ul>
    </details>
  );
}
