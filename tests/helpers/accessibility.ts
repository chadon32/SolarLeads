import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright/test";

export async function getSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .analyze();
  return results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious"
  );
}
