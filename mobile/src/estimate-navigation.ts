const INTERNAL_NAVIGATION_KEYS = [
  "address",
  "lat",
  "lng",
  "bill",
  "panel",
  "panels",
  "inverter",
  "addBattery",
  "battery",
];

/**
 * Preserve refresh-safe calculator state inside the trusted WebView boundary.
 * This URL is for internal navigation only and must never be sent to a
 * public/native share target.
 */
export function sanitizeEstimateNavigationUrl(raw: unknown, appUrl: string) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, appUrl);
    if (url.origin !== new URL(appUrl).origin || url.pathname !== "/estimate" || url.username || url.password) return null;
    const address = url.searchParams.get("address")?.trim();
    if (!address || address.length > 300) return null;
    const clean = new URL("/estimate", appUrl);
    for (const key of INTERNAL_NAVIGATION_KEYS) {
      const value = url.searchParams.get(key);
      if (value !== null && value.length <= 300) clean.searchParams.set(key, value);
    }
    return clean.toString();
  } catch {
    return null;
  }
}

export function isEstimateDocument(rawUrl: string) {
  try { return new URL(rawUrl).pathname === "/estimate"; } catch { return false; }
}
