import { APP_CANONICAL_URL, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { faqItems } from "@/lib/faq";

/**
 * JSON-LD describing the site, the service, and the homepage FAQ.
 *
 * Every claim here is one the live product actually supports. Deliberately
 * absent: aggregateRating, review, postalAddress, telephone, and foundingDate.
 * Structured data asserting things a visitor cannot verify on the page is a
 * spam-policy violation, and fabricated ratings are the fastest way to lose
 * rich results altogether — so those stay out until they are real.
 */
export function StructuredData() {
  const graph = [
    {
      "@type": "Organization",
      "@id": `${APP_CANONICAL_URL}/#organization`,
      name: APP_NAME,
      url: APP_CANONICAL_URL,
      description: APP_TAGLINE,
    },
    {
      "@type": "WebSite",
      "@id": `${APP_CANONICAL_URL}/#website`,
      url: APP_CANONICAL_URL,
      name: APP_NAME,
      description: APP_TAGLINE,
      publisher: { "@id": `${APP_CANONICAL_URL}/#organization` },
      inLanguage: "en-US",
    },
    {
      "@type": "Service",
      "@id": `${APP_CANONICAL_URL}/#service`,
      name: "Residential solar roof analysis",
      serviceType: "Solar rooftop suitability assessment",
      description:
        "Satellite and Google Solar API roof analysis for Arizona homeowners: panel layout, sunlight quality, estimated system size, and modeled savings. No cost and no obligation.",
      provider: { "@id": `${APP_CANONICAL_URL}/#organization` },
      areaServed: {
        "@type": "State",
        name: "Arizona",
      },
      audience: {
        "@type": "Audience",
        audienceType: "Arizona homeowners",
      },
      offers: {
        "@type": "Offer",
        // The roof analysis genuinely costs the homeowner nothing.
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${APP_CANONICAL_URL}/#faq`,
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      // Server-rendered from static in-repo copy, never user input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": graph,
        }),
      }}
    />
  );
}
