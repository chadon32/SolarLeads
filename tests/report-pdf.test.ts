import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFPage, type PDFPageDrawTextOptions } from "pdf-lib";
import { calculateSolarReadinessScore } from "../src/lib/solar-advisor";
import { installPdfFixture, makePdfLead, pdfFixtureRequest, PDF_TEST_ID } from "./helpers/pdf-fixture";

test("PDF download generates a protected, ten-page document offline", async () => {
  const fixture = installPdfFixture();
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    const response = await GET(pdfFixtureRequest());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    assert.equal(pdf.getPageCount(), 10);
    assert.match(pdf.getTitle() ?? "", /Solartelligence/i);
    assert.equal(fixture.updates.length, 1);
  } finally { fixture.restore(); }
});

test("PDF does not record a download when serialization fails", async () => {
  const fixture = installPdfFixture();
  const save = PDFDocument.prototype.save;
  PDFDocument.prototype.save = async () => { throw new Error("synthetic PDF failure"); };
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    const response = await GET(pdfFixtureRequest());
    assert.equal(response.status, 500);
    assert.equal(fixture.updates.length, 0);
  } finally { PDFDocument.prototype.save = save; fixture.restore(); }
});

test("PDF rejects invalid and unsigned report requests before lead access", async () => {
  const fixture = installPdfFixture();
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    assert.equal((await GET(new Request("http://localhost/api/report/pdf?leadId=bad&raw=1"))).status, 400);
    assert.equal((await GET(new Request(`http://localhost/api/report/pdf?leadId=${PDF_TEST_ID}&raw=1`))).status, 403);
    assert.equal(fixture.updates.length, 0);
  } finally { fixture.restore(); }
});

test("long PDF text stays on-page and sunlight uses saved hours, not specific yield", async () => {
  const fixture = installPdfFixture(makePdfLead("long"));
  const drawText = PDFPage.prototype.drawText;
  const runs: Array<{ text: string; options: PDFPageDrawTextOptions }> = [];
  PDFPage.prototype.drawText = function (text, options = {}) {
    runs.push({ text, options });
    return drawText.call(this, text, options);
  };
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    assert.equal((await GET(pdfFixtureRequest())).status, 200);
    assert.ok(runs.some(({ text }) => text.includes("2,050")), "Saved annual sunlight hours must appear");
    assert.ok(!runs.some(({ text }) => text.includes("1,700 modeled annual sunlight")), "kWh/kW is not sunlight hours");
    for (const { text, options } of runs) {
      if (!options.font || !options.size || options.maxWidth) continue;
      const width = options.font.widthOfTextAtSize(text, options.size);
      assert.ok((options.x ?? 0) + width <= 584, `Text exceeds page margin: ${text}`);
      assert.ok((options.y ?? 0) >= 28, `Text below footer: ${text}`);
    }
  } finally { PDFPage.prototype.drawText = drawText; fixture.restore(); }
});

test("legacy report without snapshot remains downloadable without fabricated 3D", async () => {
  const fixture = installPdfFixture(makePdfLead("missing"));
  const drawText = PDFPage.prototype.drawText;
  const texts: string[] = [];
  PDFPage.prototype.drawText = function (text, options) {
    texts.push(text);
    return drawText.call(this, text, options);
  };
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    const response = await GET(pdfFixtureRequest());
    assert.equal(response.status, 200);
    assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 10);
    assert.ok(texts.includes("Roof visual unavailable"));
    assert.ok(!texts.includes("LOW"), "Missing sunlight is not low sunlight");
    assert.ok(!texts.some((text) => text.includes("roof model supports")), "Do not invent model findings");
  } finally { PDFPage.prototype.drawText = drawText; fixture.restore(); }
});

test("a PDF preserves zero savings, zero offset and a flat roof pitch", async () => {
  const lead = makePdfLead();
  lead.report_snapshot!.metrics.annualSavings = 0;
  lead.report_snapshot!.metrics.monthlySavings = 0;
  lead.report_snapshot!.metrics.coveragePct = 0;
  lead.report_snapshot!.metrics.avgPitchDeg = 0;
  const fixture = installPdfFixture(lead);
  const drawText = PDFPage.prototype.drawText;
  const texts: string[] = [];
  PDFPage.prototype.drawText = function (text, options) {
    texts.push(text);
    return drawText.call(this, text, options);
  };
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    assert.equal((await GET(pdfFixtureRequest())).status, 200);
    assert.ok(texts.includes("$0"));
    assert.ok(texts.includes("0%"));
    assert.ok(texts.includes("0 deg roof pitch"));
    assert.ok(!texts.includes("88%"), "Do not replace saved zero coverage with a positive fallback");
  } finally { PDFPage.prototype.drawText = drawText; fixture.restore(); }
});

test("PDF readiness is recalculated from the selected system instead of legacy roof confidence", async () => {
  const lead = makePdfLead();
  const snapshot = lead.report_snapshot!;
  lead.panel_count = 2;
  lead.system_size_kw = 0.8;
  lead.annual_energy_kwh = 1_641;
  lead.annual_savings = 254;
  lead.monthly_savings = 21;
  lead.solar_suitability_score = 100;
  snapshot.panelCount = 2;
  snapshot.renderedPanelCount = 2;
  snapshot.solarReadinessScore = 100;
  snapshot.metrics = {
    ...snapshot.metrics,
    annualKwh: 1_641,
    annualSavings: 254,
    coveragePct: 11,
    monthlySavings: 21,
    panelCount: 2,
    systemKw: 0.8,
  };
  const expectedScore = calculateSolarReadinessScore({
    annualSunlightHours: snapshot.roofAnalysis.annualSunlightHours,
    coveragePct: 11,
    panelCount: 2,
    usablePctRoof: snapshot.metrics.usablePctRoof,
  });
  const expectedLabel =
    expectedScore >= 85
      ? "Strong Candidate"
      : expectedScore >= 65
        ? "Good Candidate"
        : expectedScore >= 45
          ? "Preliminary Estimate"
          : "Installer Verification Required";
  const fixture = installPdfFixture(lead);
  const drawText = PDFPage.prototype.drawText;
  const texts: string[] = [];
  PDFPage.prototype.drawText = function (text, options) {
    texts.push(text);
    return drawText.call(this, text, options);
  };
  try {
    const { GET } = await import("../src/app/api/report/pdf/route");
    assert.equal((await GET(pdfFixtureRequest())).status, 200);
    assert.ok(texts.includes(`${expectedScore}/100`));
    assert.ok(!texts.includes("100/100"));
    assert.ok(texts.includes(expectedLabel));
  } finally {
    PDFPage.prototype.drawText = drawText;
    fixture.restore();
  }
});
