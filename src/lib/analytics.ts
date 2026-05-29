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

  window.gtag("event", eventName, params);
}
