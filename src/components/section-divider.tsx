type SectionDividerProps = {
  eyebrow: string;
  title: string;
  copy: string;
};

export function SectionDivider({ eyebrow, title, copy }: SectionDividerProps) {
  return (
    <section className="relative mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-12">
      <div className="flex items-center gap-4 py-6">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-300/22 to-transparent" />
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-200 backdrop-blur-md">
          {eyebrow}
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-300/22 to-transparent" />
      </div>
      <div className="mx-auto max-w-3xl text-center">
        <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h3>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-300">
          {copy}
        </p>
      </div>
    </section>
  );
}
