import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import {
  buildSolarReportSnapshot,
  rebuildTrustedSolarReportSnapshot,
} from "../src/lib/report-snapshot";

process.env.REPORT_SIGNING_SECRET = "test-roof-proof-secret";

test("roof analysis proof verifies server-produced analysis and rejects tampering", async () => {
  const {
    buildRoofAnalysisProof,
    verifyRoofAnalysisProof,
  } = await import("../src/lib/roof-analysis-proof");
  const address = "6420 E Nance St, Mesa, AZ 85215";
  const analysis = buildFallbackRoofAnalysis({
    address,
    lat: 33.415,
    lng: -111.831,
  });
  const proof = buildRoofAnalysisProof({ address, analysis });

  assert.ok(proof);
  assert.equal(
    verifyRoofAnalysisProof({ address, analysis, proof }).ok,
    true
  );
  assert.equal(
    verifyRoofAnalysisProof({
      address,
      analysis: { ...analysis, panelCount: analysis.panelCount + 100 },
      proof,
    }).ok,
    false
  );
  assert.equal(
    verifyRoofAnalysisProof({
      address: "6042 E Nance St, Mesa, AZ 85215",
      analysis,
      proof,
    }).ok,
    false
  );
});

test("roof analysis proof rejects expired signatures", async () => {
  const {
    buildRoofAnalysisProof,
    verifyRoofAnalysisProof,
  } = await import("../src/lib/roof-analysis-proof");
  const address = "6420 E Nance St, Mesa, AZ 85215";
  const analysis = buildFallbackRoofAnalysis({
    address,
    lat: 33.415,
    lng: -111.831,
  });
  const proof = buildRoofAnalysisProof({
    address,
    analysis,
    expiresInSeconds: -1,
  });
  const result = verifyRoofAnalysisProof({ address, analysis, proof });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? false : result.expired, true);
});

test("trusted snapshot rebuild recomputes metrics from roof analysis instead of client numbers", () => {
  const address = "6420 E Nance St, Mesa, AZ 85215";
  const analysis = buildFallbackRoofAnalysis({
    address,
    lat: 33.415,
    lng: -111.831,
  });
  const snapshot = buildSolarReportSnapshot({
    address,
    analysis,
    monthlyBill: 200,
  });
  const trusted = rebuildTrustedSolarReportSnapshot(
    {
      ...snapshot,
      metrics: {
        ...snapshot.metrics,
        annualSavings: 999_999,
        coveragePct: 999,
        panelCount: 999,
        systemKw: 999,
      },
      panelCount: 999,
    },
    { monthlyBill: 200 }
  );

  assert.notEqual(trusted.metrics.annualSavings, 999_999);
  assert.notEqual(trusted.metrics.systemKw, 999);
  assert.ok(trusted.metrics.coveragePct <= 100);
  assert.ok(trusted.panelCount <= analysis.panelCount);
});
