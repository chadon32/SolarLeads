import Link from "next/link";
import { buildReportPdfPath } from "@/lib/report-access";

type ReportViewerPageProps = {
  params: Promise<{
    leadId: string;
  }>;
};

export const metadata = {
  title: "Solar Report PDF | Arizona Solar AI",
  description: "View and download a homeowner solar report PDF.",
};

export default async function ReportViewerPage({ params }: ReportViewerPageProps) {
  const { leadId } = await params;
  const pdfPath = buildReportPdfPath(leadId);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_34%),linear-gradient(180deg,#05070d_0%,#07111d_68%,#06070b_100%)] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-col justify-between gap-3 rounded-[1.4rem] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_70px_rgba(2,8,20,0.32)] backdrop-blur-xl sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
              Arizona Solar AI
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Solar report PDF
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              If the preview does not load, use the raw PDF button below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
            >
              Back to dashboard
            </Link>
            <a
              href={pdfPath}
              className="inline-flex items-center justify-center rounded-full bg-cyan-100 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white"
            >
              Open raw PDF
            </a>
          </div>
        </header>

        <section className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-slate-950/60 shadow-[0_18px_70px_rgba(2,8,20,0.36)]">
          <iframe
            src={pdfPath}
            title="Solar report PDF preview"
            className="h-[78vh] w-full bg-white"
          />
        </section>
      </div>
    </main>
  );
}
