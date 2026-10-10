import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { publicPageMetadata } from "@/lib/seo";
import {
  ARIZONA_EXPORT_CREDIT_PER_KWH,
  ARIZONA_EXPORT_CREDIT_SOURCE,
  ARIZONA_FIXED_MONTHLY_CHARGE,
} from "@/lib/solar-assumptions";
import { ARIZONA_AVG_RATE_PER_KWH } from "@/lib/solar-metrics";

export const metadata: Metadata = publicPageMetadata({
  title: "About",
  description: `What ${APP_NAME} is, where its solar estimates come from, and how to reach us.`,
  path: "/about",
});

const CONTACT_EMAIL = "reports@solartelligence.com";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-night px-5 py-12 text-ink sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-sky-200 hover:text-ink">
          {APP_NAME}
        </Link>
        <h1 className="font-editorial mt-4 text-4xl text-ink sm:text-5xl">About {APP_NAME}</h1>
        <p className="mt-5 text-lg leading-8 text-ink-muted">
          {APP_NAME} is a free solar estimate for Arizona homes. Enter your address and average
          monthly electric bill to see a 3D model of your roof, where panels could fit, and what solar
          might save you.
        </p>

        <AboutSection title="Where the numbers come from">
          <p>
            Roof shape, sunlight and panel positions come from Google&rsquo;s Solar data for your
            address. Savings use Arizona utility figures: an average electricity price of $
            {ARIZONA_AVG_RATE_PER_KWH.toFixed(3)} per kWh, a ${ARIZONA_FIXED_MONTHLY_CHARGE} monthly fixed
            charge that stays on your bill, and a credit of ${ARIZONA_EXPORT_CREDIT_PER_KWH.toFixed(4)} per
            kWh for power sent to the grid (
            <a
              className="text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink"
              href={ARIZONA_EXPORT_CREDIT_SOURCE.url}
              rel="noreferrer"
              target="_blank"
            >
              {ARIZONA_EXPORT_CREDIT_SOURCE.label}
            </a>
            ). Every estimate lists its inputs under &ldquo;How this estimate was calculated&rdquo;.
          </p>
        </AboutSection>

        <AboutSection title="What an estimate is, and isn’t">
          <p>
            It&rsquo;s a preliminary estimate, not an installation quote or an engineering plan. An
            installer confirms the real layout, price and savings after visiting your home.
          </p>
        </AboutSection>

        <AboutSection title="Who sees your details">
          <p>
            We use your information to deliver your report. We share it with a solar provider only
            when you ask for installer follow-up; otherwise nobody contacts you. Read the{" "}
            <Link className="text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink" href="/privacy">
              privacy notice
            </Link>{" "}
            and the{" "}
            <Link className="text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink" href="/terms">
              estimate terms
            </Link>
            .
          </p>
        </AboutSection>

        <AboutSection title="Where we work">
          <p>We currently serve Arizona addresses only.</p>
        </AboutSection>

        <AboutSection title="Contact">
          <p>
            Questions about a report, a correction, or a data request? Email{" "}
            <a
              className="font-semibold text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-ink"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </AboutSection>

        <div className="mt-10">
          <Link href="/#address-estimate" className="btn btn-primary">
            Start my solar estimate
          </Link>
        </div>
      </article>
    </main>
  );
}

function AboutSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="mt-8 border-t border-ridge pt-6">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-2 text-base leading-7 text-ink-muted">{children}</div>
    </section>
  );
}
