import type { ReactNode } from "react";
import { SparklesIcon } from "lucide-react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

/** Encabezado editorial de cada sección: antetítulo pequeño y título en serif. */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">{eyebrow}</p>
        <h1 className="font-display text-4xl leading-none sm:text-5xl">{title}</h1>
        {description && <p className="max-w-xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

type ComingSoonProps = {
  title: string;
  children: ReactNode;
};

/** Estado de una sección que se completa en la siguiente fase. */
export function ComingSoon({ title, children }: ComingSoonProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-dashed bg-card/60 p-8 shadow-[var(--shadow-soft)] sm:p-12">
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-brand-soft blur-3xl" aria-hidden />
      <div className="relative flex max-w-lg flex-col gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <SparklesIcon className="size-5" aria-hidden />
        </span>
        <h2 className="font-display text-2xl">{title}</h2>
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}
