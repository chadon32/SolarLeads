import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

function render(view: string) {
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(__dirname, "helpers", "render-dashboard-crm.ts"),
      view,
    ],
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
}

test("workspace has deep-linked navigation, cohort controls, and accessible chart data", () => {
  const html = render("overview");
  for (const view of ["overview", "pipeline", "analytics", "follow-ups"]) {
    assert.ok(html.includes(`/dashboard?view=${view}`));
  }
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('aria-label="Submission period"'));
  assert.ok(html.includes("Include test leads"));
  assert.ok(html.includes("View daily counts"));
  assert.ok(html.includes("Open modeled value"));
  assert.ok(!html.includes("Bill verified"));
});

test("analytics explains win rate, modeled value, missing data, and report completeness", () => {
  const html = render("analytics");
  assert.ok(html.includes("Equipment interest"));
  assert.ok(html.includes("Report completeness"));
  assert.ok(html.includes("not website conversion"));
  assert.ok(html.includes("not sales revenue"));
  assert.ok(html.includes("Missing values are excluded"));
});

test("an unavailable delivery queue is not presented as a successful empty queue", () => {
  const html = render("follow-ups");
  assert.ok(html.includes("Follow-up data unavailable"));
  assert.ok(!html.includes(">Send now<"));
});
