import Script from "next/script";

export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();

  if (!measurementId) {
    // Without the measurement id gtag never loads, so every trackEvent() call
    // silently no-ops and the funnel reports nothing. That is fine locally but
    // invisible — and catastrophic in production, where it means paying for ad
    // traffic with no conversion data. Say so loudly at build/render time.
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[analytics] NEXT_PUBLIC_GA_MEASUREMENT_ID is not set — Google Analytics is disabled and all funnel events are being dropped."
      );
    }

    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  );
}
