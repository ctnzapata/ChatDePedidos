import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

/** Encabezado de cada sección: antetítulo mono con marca de ají y título condensado. */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2.5">
        <p className="label-mono flex items-center gap-2 text-muted-foreground">
          <span className="h-px w-5 bg-brand" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="font-display text-4xl leading-[0.92] sm:text-[3.25rem]">{title}</h1>
        {description && <p className="max-w-xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
