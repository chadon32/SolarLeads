import type { Metadata } from "next";
import Link from "next/link";
import { PrintWorksheetButton } from "@/components/print-worksheet-button";
import { APP_CANONICAL_URL, APP_NAME } from "@/lib/brand";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Arizona Solar Guide: Roof Suitability & Savings",
  description: "Learn how to read a solar roof estimate, compare system size and savings assumptions, and check APS or SRP requirements before requesting an installer quote.",
  path: "/solar-guide",
});

const topics = [
  ["start", "Start with your home"],
  ["roof", "Understand the roof model"],
  ["savings", "Check the savings assumptions"],
  ["assumptions", "Read the assumptions"],
  ["utilities", "Check your utility"],
  ["report", "Use your report"],
  ["worksheet", "Print the worksheet"],
] as const;

const REVIEWED_DATE = "September 23, 2026";

export default function SolarGuidePage() {
  return (
    <main className="solar-guide-page min-h-screen bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.12),transparent_50%),#05070b] px-5 py-8 text-slate-100 sm:px-8 sm:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: APP_CANONICAL_URL },
          { "@type": "ListItem", position: 2, name: "Arizona solar guide", item: `${APP_CANONICAL_URL}/solar-guide` },
        ],
      }) }} />
      <article className="mx-auto max-w-4xl">
        <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Arizona solar guide</span>
        </nav>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">{APP_NAME} / Homeowner guide</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-tight tracking-tight sm:text-6xl" style={{ fontFamily: "var(--font-editorial), serif" }}>
            Is your Arizona home a good fit for solar?
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
            Start with the roof. Then check the numbers. This guide explains what
            a preliminary solar estimate can tell you, what it cannot, and what
            to verify before choosing an installer.
          </p>
          <p className="mt-3 text-sm text-slate-400">Reviewed {REVIEWED_DATE}. Educational guidance, not an installation quote.</p>
          <Link href="/#address-estimate" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-cyan-200 px-6 py-3 font-semibold text-slate-950 transition hover:bg-white">
            Check my roof with the free calculator
          </Link>
        </header>
        <nav aria-label="On this page" className="my-9 flex flex-wrap gap-2 border-y border-white/10 py-5">
          {topics.map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm text-cyan-100 hover:bg-white/5">{label}</a>)}
        </nav>
        <GuideSection id="start" title="1. Start with your address and electricity use">
          <p>Use the calculator on the homepage, select a suggested Arizona address, and enter your average monthly electric bill. If you have a full year of bills, use the average rather than only a high summer month.</p>
          <p>Solartelligence uses these inputs to prepare a roof analysis and modeled savings. It is an analysis and report tool, not your installation contractor. There is no homeowner account required to explore the results.</p>
        </GuideSection>
        <GuideSection id="roof" title="2. Read the roof model as a starting point">
          <p>The Sunlight view helps you inspect the roof imagery. The 3D Model view shows a preliminary layout and sunlight-quality layer when the necessary data is available. Google&apos;s Solar API provides building insights and data layers; coverage and imagery vary. <Source href="https://developers.google.com/maps/documentation/solar/overview">Google Solar API overview</Source>.</p>
          <p>A satellite model cannot confirm roof condition, structural capacity, every obstruction, or an installation-ready design. Ask an installer to verify the roof on site, along with electrical capacity, setbacks, and final panel placement.</p>
          <p>The maximum panel count is a roof-capacity estimate, not automatically the best system for your home. Adjust the selected count and compare it with your energy needs.</p>
        </GuideSection>
        <GuideSection id="savings" title="3. Separate roof capacity from financial savings">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["kW: system size", "The power rating of the selected panels. It is not an annual energy figure."],
              ["kWh: energy", "An amount of electricity used or generated over time. Compare the same time periods."],
              ["Bill savings", "Modeled utility-cost reduction. Check remaining utility charges and any loan payments separately."],
              ["Payback", "A modeled recovery period based on costs and savings assumptions, not a guaranteed return."],
            ].map(([term, definition]) => <div key={term} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><dt className="font-semibold text-white">{term}</dt><dd className="mt-2">{definition}</dd></div>)}
          </dl>
          <p>Compare the same panel count, equipment, battery choice, and payment method across scenarios. Request an itemized installed quote and verify current incentives and eligibility rather than treating a calculator assumption as a promised discount.</p>
        </GuideSection>
        <GuideSection id="assumptions" title="4. How to read this result">
          <p>Every number in a Solartelligence report is a preliminary model. The source badge beside a readout tells you whether a value came from available roof data, a homeowner adjustment, a published equipment input, or a planning assumption.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AssumptionCard title="Roof and sunlight" source="Google Solar API" href="https://developers.google.com/maps/documentation/solar/overview">
              Roof planes, available area, and sunlight quality come from the available building data. Coverage and imagery vary, so an installer must verify measurements, condition, obstructions, and setbacks.
            </AssumptionCard>
            <AssumptionCard title="Production" source="NREL PVWatts guidance" href="https://pvwatts.nrel.gov/">
              Production is modeled from the roof profile, panel count, panel characteristics, and available sunlight. It is not a production guarantee and degradation is not modeled here.
            </AssumptionCard>
            <AssumptionCard title="Electricity rate" source="U.S. Energy Information Administration" href="https://www.eia.gov/electricity/state/arizona/">
              The calculator uses an Arizona planning rate to translate modeled energy into a savings estimate. Check your actual utility tariff, fixed charges, demand charges, and export compensation.
            </AssumptionCard>
            <AssumptionCard title="Installed cost planning" source="EnergySage Arizona marketplace" href="https://www.energysage.com/local-data/solar-panel-cost/az/">
              Cost values are market planning inputs, not panel prices, bids, financing approvals, or an installer quote. Compare itemized proposals with the same equipment and scope.
            </AssumptionCard>
          </div>
          <div className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-5 text-sm leading-7 text-amber-50">
            <p className="font-semibold">Policy-sensitive numbers need a fresh check.</p>
            <p className="mt-2">This guide does not promise a current federal or state incentive. Confirm eligibility, timing, and tax treatment with current government and utility sources before using an incentive in your decision.</p>
          </div>
        </GuideSection>
        <GuideSection id="utilities" title="5. Check your actual utility plan">
          <p>Do not choose a utility based only on your city. Check your bill. Solar production, energy used in the home, and exported energy are different inputs to the final bill.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.035] p-5"><h3 className="mb-2 font-semibold text-white">APS customers</h3><p>APS says grid-connected solar customers continue to receive a monthly bill. Confirm the applicable plan, export credits, and remaining charges using <Source href="https://www.aps.com/solar">APS rooftop solar guidance</Source>.</p></div>
            <div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.035] p-5"><h3 className="mb-2 font-semibold text-white">SRP customers</h3><p>SRP provides solar-plan information and a calculator through My Account. Review your options in <Source href="https://www.srpnet.com/energy-savings-rebates/home/residential-solar/rooftop-solar">SRP&apos;s homeowner solar guide</Source>.</p></div>
          </div>
          <p>For another utility, use its current solar and interconnection guidance. These links take you to the utilities&apos; own resources, not an installation quote from Solartelligence.</p>
        </GuideSection>
        <GuideSection id="report" title="6. Turn the estimate into better questions">
          <p>Explore the report&apos;s roof, panel, savings, and financing sections before requesting the emailed report. The report form asks for contact details; uploading a utility bill is optional. Installer follow-up is a separate opt-in, not a condition of receiving the report.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Does the proposed layout match a current site inspection?</li>
            <li>Which production, utility-rate, and export-credit assumptions were used?</li>
            <li>What is included in the installed price, warranty, and financing cost?</li>
            <li>What remains on the utility bill after solar?</li>
          </ul>
          <p>Read the <Link href="/terms" className="text-cyan-100 underline underline-offset-4">estimate limitations</Link> and <Link href="/privacy" className="text-cyan-100 underline underline-offset-4">privacy notice</Link> before sharing your information.</p>
        </GuideSection>
        <section id="worksheet" className="print-sheet scroll-mt-8 rounded-3xl border border-cyan-200/20 bg-slate-950/80 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Printable worksheet</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Questions to take to an installer</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">Use this after reviewing your preliminary report. It helps you compare a site visit and itemized proposals without putting your address, bill, or report ID into a public link.</p>
            </div>
            <PrintWorksheetButton />
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <WorksheetGroup title="Roof and electrical checks" items={[
              "Roof condition, age, warranty, and structural capacity",
              "Obstructions, shade, pathways, setbacks, and final layout",
              "Main panel capacity, electrical work, permits, and interconnection",
            ]} />
            <WorksheetGroup title="Energy and utility checks" items={[
              "Twelve months of usage or bills and the actual rate plan",
              "Remaining fixed charges, demand charges, and export compensation",
              "Production estimate, degradation, monitoring, and warranty terms",
            ]} />
            <WorksheetGroup title="Equipment and money checks" items={[
              "Panel, inverter, battery, labor, warranty, and maintenance scope",
              "Cash price, loan APR and term, lease or PPA escalation, and fees",
              "Current incentive eligibility confirmed with a current source",
            ]} />
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <h3 className="font-semibold text-white">Notes for my next conversation</h3>
              <div className="mt-4 space-y-5 text-sm text-slate-400">
                <div className="border-b border-dashed border-white/20 pb-2">Utility plan:</div>
                <div className="border-b border-dashed border-white/20 pb-2">Installer question:</div>
                <div className="border-b border-dashed border-white/20 pb-2">Follow-up date:</div>
              </div>
            </div>
          </div>
          <p className="mt-6 text-xs leading-6 text-slate-400">Last reviewed {REVIEWED_DATE}. Sources: <Source href="https://developers.google.com/maps/documentation/solar/overview">Google Solar API</Source>, <Source href="https://pvwatts.nrel.gov/">NREL PVWatts</Source>, and your utility&apos;s current customer guidance. Planning worksheet only; final design, pricing, incentives, and savings require verification.</p>
        </section>
        <footer className="mt-9 rounded-3xl border border-cyan-200/20 bg-slate-950/80 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">Explore your own roof, without a sales call.</h2>
          <p className="mt-3 text-slate-300">Free preliminary analysis for Arizona homeowners. Final design and savings require verification.</p>
          <Link href="/#address-estimate" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-cyan-200 px-6 py-3 font-semibold text-slate-950 hover:bg-white">Start my solar estimate</Link>
        </footer>
      </article>
    </main>
  );
}

function AssumptionCard({
  children,
  href,
  source,
  title,
}: {
  children: React.ReactNode;
  href: string;
  source: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6">{children}</p>
      <p className="mt-3 text-xs text-slate-400">Source: <Source href={href}>{source}</Source></p>
    </div>
  );
}

function WorksheetGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <fieldset className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <legend className="px-1 font-semibold text-white">{title}</legend>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <label key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-300">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-cyan-300" aria-label={item} />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="text-cyan-100 underline decoration-cyan-200/50 underline-offset-4 hover:text-white">{children}</a>;
}

function GuideSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-8 border-b border-white/10 py-7"><h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2><div className="mt-4 space-y-4 text-base leading-7 text-slate-300">{children}</div></section>;
}
