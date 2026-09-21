import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeSectionNavigationScript,
  initialNativeAnalysisState,
  transitionNativeAnalysisState,
} from "../mobile/src/analysis-bridge";

test("native analysis tabs remain disabled until the analysis reports done", () => {
  const loading = transitionNativeAnalysisState(initialNativeAnalysisState, {
    type: "analysis-status",
    status: "loading",
  });
  const done = transitionNativeAnalysisState(loading, {
    type: "analysis-status",
    status: "done",
  });

  assert.deepEqual(loading, initialNativeAnalysisState);
  assert.deepEqual(done, { activeSection: "roof", analysisReady: true });
});

test("analysis errors and reload boundaries reset native tab readiness", () => {
  const done = transitionNativeAnalysisState(initialNativeAnalysisState, {
    type: "analysis-status",
    status: "done",
  });

  for (const event of [
    { type: "analysis-status" as const, status: "error" },
    { type: "analysis-status" as const, status: "invalid" },
    { type: "reset" as const },
  ]) {
    assert.deepEqual(
      transitionNativeAnalysisState(done, event),
      initialNativeAnalysisState
    );
  }
});

test("only a valid injected section acknowledgement selects a native tab", () => {
  const ready = transitionNativeAnalysisState(initialNativeAnalysisState, {
    type: "analysis-status",
    status: "done",
  });

  // A missing DOM target emits no acknowledgement, so the native selection stays put.
  assert.deepEqual(ready, { activeSection: "roof", analysisReady: true });
  assert.deepEqual(
    transitionNativeAnalysisState(ready, {
      type: "analysis-section",
      section: "report",
    }),
    { activeSection: "report", analysisReady: true }
  );
  assert.deepEqual(
    transitionNativeAnalysisState(ready, {
      type: "analysis-section",
      section: "unknown",
    }),
    ready
  );
  assert.deepEqual(
    transitionNativeAnalysisState(
      { activeSection: "report", analysisReady: true },
      { type: "analysis-status", status: "done" }
    ),
    { activeSection: "report", analysisReady: true }
  );
  assert.deepEqual(
    transitionNativeAnalysisState(initialNativeAnalysisState, {
      type: "analysis-section",
      section: "overview",
    }),
    initialNativeAnalysisState
  );
});

test("injected navigation acknowledges only after its target exists", () => {
  const messages: string[] = [];
  const run = (document: unknown) =>
    new Function(
      "window",
      "document",
      "requestAnimationFrame",
      createNativeSectionNavigationScript("report")
    )(
      { ReactNativeWebView: { postMessage: (message: string) => messages.push(message) } },
      document,
      (callback: () => void) => callback()
    );

  run({
    getElementById: () => null,
    querySelectorAll: () => [],
  });
  assert.deepEqual(messages, []);

  run({
    getElementById: () => ({
      querySelectorAll: () => [],
      scrollIntoView: () => assert.fail("must not scroll"),
    }),
  });
  assert.deepEqual(messages, []);

  run({
    getElementById: () => ({
      isConnected: false,
      querySelectorAll: () => [
        { click: () => undefined, textContent: "Send Report" },
      ],
      scrollIntoView: () => assert.fail("detached target must not scroll"),
    }),
  });
  assert.deepEqual(messages, []);

  let tabClicked = false;
  let scrolled = false;
  run({
    getElementById: () => ({
      querySelectorAll: () => [
        { click: () => (tabClicked = true), textContent: "Send Report" },
      ],
      scrollIntoView: () => (scrolled = true),
    }),
  });

  assert.equal(tabClicked, true);
  assert.equal(scrolled, true);
  assert.deepEqual(JSON.parse(messages[0]!), {
    section: "report",
    type: "analysis-section",
  });
});
