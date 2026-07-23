import type { Metadata } from "next";
import Link from "next/link";
import { APP_CANONICAL_URL, APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: `How ${APP_NAME} uses information submitted for a solar report.`,
  alternates: { canonical: `${APP_CANONICAL_URL}/privacy` },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_32%),#05070b] px-5 py-12 text-slate-100 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-[1.5rem] border border-white/10 bg-slate-950/72 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
          {APP_NAME}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Privacy notice</h1>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          This notice describes the current application behavior. It is not a
          claim of certification or legal compliance.
        </p>
        <NoticeSection title="Information collected">
          We collect the contact, property, electricity-bill, report-request,
          and optional utility-bill information you submit. We also process
          limited technical data for security and abuse prevention.
        </NoticeSection>
        <NoticeSection title="How information is used">
          We use submitted information to generate, save, and email your solar
          readiness report, operate the dashboard, prevent abuse, and support
          the service. We send installer/admin lead details only when you
          explicitly request installer follow-up.
        </NoticeSection>
        <NoticeSection title="Service providers">
          The application uses service providers including Google Maps and
          Solar APIs, Supabase, Resend, and Vercel to provide address, roof,
          storage, email, database, and hosting functions. Those providers
          process data under their own terms and policies.
        </NoticeSection>
        <NoticeSection title="Utility bills and report links">
          Utility bills are kept in private storage and are not shown on public
          report pages. Homeowner report links are signed and expire. Do not
          forward a report link unless you intend to share that report.
        </NoticeSection>
        <NoticeSection title="Retention and requests">
          The current application stores lead and report records in Supabase. A
          formal retention period and self-service deletion workflow are not yet
          implemented. To request access, correction, or deletion, email
          reports@solartelligence.com.
        </NoticeSection>
        <Link
          href="/"
          className="mt-9 inline-flex min-h-11 items-center rounded-full bg-cyan-100 px-5 py-3 text-sm font-semibold text-slate-950"
        >
          Back to {APP_NAME}
        </Link>
      </article>
    </main>
  );
}

function NoticeSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="mt-7 border-t border-white/10 pt-6">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-slate-300">{children}</p>
    </section>
  );
}
