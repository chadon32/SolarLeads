const SHARE_KEYS = ["address", "lat", "lng", "bill", "panel", "panels", "inverter", "addBattery", "battery"];

/** Only public estimate settings may cross the native share boundary. */
export function sanitizeEstimateShareUrl(raw: unknown, appUrl: string) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, appUrl);
    if (url.origin !== new URL(appUrl).origin || url.pathname !== "/estimate" || url.username || url.password) return null;
    const address = url.searchParams.get("address")?.trim();
    if (!address || address.length > 300) return null;
    const clean = new URL("/estimate", appUrl);
    for (const key of SHARE_KEYS) {
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
