import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Synthetic fixture only: no account number, actual customer bill, or payment data.
const directory = new URL("../qa-evidence/production-verification-2026-09-22/", import.meta.url);
await mkdir(directory, { recursive: true });
const document = await PDFDocument.create();
document.setTitle("QA TEST - Synthetic Utility Bill - Not a Real Bill");
const page = document.addPage([612, 792]);
const font = await document.embedFont(StandardFonts.Helvetica);
const lines = [
  "QA TEST - SYNTHETIC UTILITY BILL",
  "NOT A REAL BILL - DO NOT PAY OR CONTACT",
  "Solartelligence production upload verification",
  "Test date: September 22, 2026",
  "Example monthly amount: $200.00",
  "This file contains no actual utility account or customer data.",
  "Installer contact and marketing follow-up must remain disabled.",
];
lines.forEach((text, index) => page.drawText(text, {
  x: 40, y: 735 - index * 40, size: index === 0 ? 18 : 12, font,
  color: rgb(0.05, 0.12, 0.18),
}));
await writeFile(new URL("QA-TEST-synthetic-bill.pdf", directory), await document.save());
console.log("Created synthetic PDF fixture in qa-evidence/production-verification-2026-09-22.");
