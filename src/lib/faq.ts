/**
 * Homepage FAQ content.
 *
 * Shared so the rendered accordion and the FAQPage structured data are driven
 * by one source: Google requires JSON-LD answers to match what a visitor can
 * actually see on the page, and duplicated copies drift apart silently.
 */
export const faqItems = [
  {
    question: "Will this damage my roof?",
    answer:
      "A qualified installer should inspect the roof and select an attachment system appropriate for its condition and construction. Final mounting, flashing, and warranty details belong in the installer proposal.",
  },
  {
    question: "What if I sell my house?",
    answer:
      "Solar can add value. Homes with solar often attract buyers looking for lower utility costs, but final value depends on ownership structure, system age, and local market conditions.",
  },
  {
    question: "Is this a sales call?",
    answer:
      "No installer contact is required to receive your report. You can separately opt in to installer follow-up when submitting the report form.",
  },
  {
    question: "How accurate is the estimate?",
    answer:
      "When available, roof geometry and sunlight inputs come from Google Solar data and satellite imagery. Savings are modeled from your monthly bill and stated assumptions. Final layout, pricing, incentives, and savings require installer confirmation.",
  },
  {
    question: "Do I need good credit?",
    answer:
      "Financing eligibility and terms vary by lender and homeowner. The report can illustrate common cash and loan scenarios, but it does not represent approval or a financing offer.",
  },
  {
    question: "How long does installation take?",
    answer:
      "Installation commonly takes 1-2 days, plus additional time for permits, utility approval, and final inspection.",
  },
] as const;
