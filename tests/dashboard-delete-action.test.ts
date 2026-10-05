import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("every lead row offers delete next to PDF, Open and Email", () => {
  // The detail panel's delete button stacks below the whole table on screens
  // under 1280px, where it was easy to miss; each row now has its own.
  const html = execFileSync(
    process.execPath,
    ["--import", "tsx", path.join(__dirname, "helpers", "render-dashboard-crm.ts")],
    { cwd: path.join(__dirname, ".."), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } }
  );
  for (const name of ["Avery", "Blake"]) {
    assert.match(html, new RegExp(`<button[^>]*aria-label="Delete ${name}"`), `row delete for ${name}`);
  }
});
