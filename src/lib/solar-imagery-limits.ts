import "server-only";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";

export function getSolarImageryLimits(request: Request) {
  try {
    if (verifyDashboardRequest(request).ok) {
      // A stable, separate bucket survives re-login and does not consume visitors' allowance.
      return { hourly: 300, daily: 1500, key: "dashboard-imagery-testing" };
    }
  } catch {
    // Malformed cookies must not grant elevated access or break public imagery.
  }

  return { hourly: 60, daily: 300, key: undefined };
}
