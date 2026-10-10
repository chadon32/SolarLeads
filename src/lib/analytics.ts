type GtagEventParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Analytics is intentionally aggregate-only. Keep this list small and
 * explicit so a future caller cannot accidentally turn an event into a
 * transport for report, contact, property, or URL data.
 */
const ALLOWED_EVENT_PARAM_KEYS = new Set([
  "content_version",
  "contact_requested",
  "output",
  "panel_count_bucket",
  "placement",
  "surface",
]);

const SENSITIVE_VALUE_PATTERN =
  /address|bill|coordinate|email|https?:\/\/|lead|latitude|longitude|name|phone|report|token|url/i;

declare global {
  interface Window {
    gtag?: (
      command: "config" | "event",
      eventName: string,
      params?: GtagEventParams
    ) => void;
  }
}

export function trackEvent(eventName: string, params: GtagEventParams = {}) {
  if (typeof window === "undefined" || !window.gtag) {
    return;
  }

  if (!/^[a-z0-9_]+$/i.test(eventName)) {
    return;
  }

  const safeParams = Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => ALLOWED_EVENT_PARAM_KEYS.has(key))
      .filter(
        ([, value]) =>
          typeof value !== "string" || !SENSITIVE_VALUE_PATTERN.test(value)
      )
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 100) : value,
      ])
  );

  window.gtag("event", eventName.slice(0, 40), safeParams);
}
