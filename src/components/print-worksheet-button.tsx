"use client";

import { trackEvent } from "@/lib/analytics";

export function PrintWorksheetButton() {
  return (
    <button
      type="button"
      onClick={() => {
        trackEvent("worksheet_print_requested", { surface: "solar-guide" });
        window.print();
      }}
      className="print-hide inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-200/25 bg-cyan-200/10 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/20"
    >
      Print or save this worksheet
    </button>
  );
}
