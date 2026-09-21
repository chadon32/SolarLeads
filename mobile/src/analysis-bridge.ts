export type AnalysisSection = "roof" | "overview" | "report";

export type NativeAnalysisState = {
  activeSection: AnalysisSection;
  analysisReady: boolean;
};

export type NativeAnalysisEvent =
  | { type: "analysis-status"; status: unknown }
  | { type: "analysis-section"; section: unknown }
  | { type: "reset" };

export const initialNativeAnalysisState: NativeAnalysisState = {
  activeSection: "roof",
  analysisReady: false,
};

export function createNativeSectionNavigationScript(section: AnalysisSection) {
  const target =
    section === "roof"
      ? "document.getElementById('rooftop-analysis') || document.getElementById('solar-workspace')"
      : section === "report"
        ? "document.getElementById('report-dashboard') || document.getElementById('generate-report')"
        : "document.getElementById('report-dashboard')";
  const tabLabel = section === "report" ? "Send Report" : "Overview";
  const selectTab =
    section === "roof"
      ? ""
      : `
      var report = document.getElementById('report-dashboard');
      if (!report) return;
      var tabs = Array.prototype.slice.call(report.querySelectorAll('[role="tab"]'));
      var tab = tabs.find(function (item) { return (item.textContent || '').trim() === '${tabLabel}'; });
      if (!tab) return;
      tab.click();`;

  return `
    (function () {
      var target = ${target};
      if (!target) return;${selectTab}
      requestAnimationFrame(function () {
        if ('isConnected' in target && !target.isConnected) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'analysis-section', section: '${section}' }));
      });
    })(); true;
  `;
}

export function transitionNativeAnalysisState(
  state: NativeAnalysisState,
  event: NativeAnalysisEvent
): NativeAnalysisState {
  if (event.type === "reset") return { ...initialNativeAnalysisState };

  if (event.type === "analysis-status") {
    if (event.status === "done") {
      return state.analysisReady
        ? state
        : { activeSection: "roof", analysisReady: true };
    }
    if (event.status === "invalid" || event.status === "error") {
      return { ...initialNativeAnalysisState };
    }
    return state;
  }

  if (
    !state.analysisReady ||
    (event.section !== "roof" &&
      event.section !== "overview" &&
      event.section !== "report")
  ) {
    return state;
  }

  return { ...state, activeSection: event.section };
}
