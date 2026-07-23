type GtagEventParams = Record<string, string | number | boolean | null | undefined>;

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

  const safeParams = Object.fromEntries(
    Object.entries(params)
      .filter(
        ([key]) =>
          !/address|email|phone|name|lead|report|url|bill|saving/i.test(key)
      )
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 100) : value,
      ])
  );

  window.gtag("event", eventName.slice(0, 40), safeParams);
}
