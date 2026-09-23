import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { installPdfFixture, makePdfLead, pdfFixtureRequest } from "../tests/helpers/pdf-fixture";

async function main() {
  const phase = process.argv[2] ?? "after";
  const directory = path.resolve("output/pdf", phase);
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const variant of ["standard", "long", "missing"]) {
    const fixture = installPdfFixture(makePdfLead(variant));
    try {
      const { GET } = await import("../src/app/api/report/pdf/route");
      const start = performance.now();
      const response = await GET(pdfFixtureRequest());
      if (response.status !== 200) throw new Error(await response.text());
      const bytes = Buffer.from(await response.arrayBuffer());
      const elapsedMs = Math.round(performance.now() - start);
      const document = await PDFDocument.load(bytes);
      const filename = path.join(directory, `solartelligence-${variant}.pdf`);
      await writeFile(filename, bytes);
      results.push({ variant, filename, pages: document.getPageCount(), bytes: bytes.length, elapsedMs, updates: fixture.updates.length });
    } finally { fixture.restore(); }
  }
  await writeFile(path.join(directory, "measurements.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
