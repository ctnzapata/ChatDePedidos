import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Vistas previas de las secciones que se completan en las Fases 5 y 6: muestran la forma real de la pantalla
// (tablero, cifras o lista) en lugar de una tarjeta genérica de "próximamente".

const BOARD_COLUMNS = [
  { label: "Nuevos", color: "bg-status-new" },
  { label: "Preparando", color: "bg-status-preparing" },
  { label: "En camino", color: "bg-status-route" },
  { label: "Listos", color: "bg-status-ready" },
] as const;

const STAT_TILES = ["Ventas", "Pedidos", "Ticket promedio", "Tiempo de preparación"] as const;
// Alturas fijas de una jornada típica (almuerzo y cena), solo ilustrativas.
const HOURLY_SHAPE = [8, 10, 18, 46, 72, 58, 30, 22, 26, 44, 80, 92, 66, 34] as const;

function GhostLine({ className }: { className?: string }) {
  return <span className={cn("block h-2 rounded-full bg-muted", className)} />;
}

function GhostTicket({ isFaded = false }: { isFaded?: boolean }) {
  return (
    <div className={cn("ticket-edge space-y-2.5 rounded-t-md border border-b-0 bg-card px-3 pt-3 pb-5", isFaded && "opacity-50")}>
      <div className="flex items-center justify-between">
        <GhostLine className="w-14 bg-foreground/15" />
        <GhostLine className="w-8" />
      </div>
      <GhostLine className="w-4/5" />
      <GhostLine className="w-3/5" />
    </div>
  );
}

function BoardPreview() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {BOARD_COLUMNS.map((column, index) => (
        <section key={column.label} className="rounded-lg border bg-secondary/50 p-2.5">
          <span className={cn("mb-3 block h-1 rounded-full", column.color)} />
          <header className="mb-3 flex items-center justify-between px-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className={cn("size-2 rounded-full", column.color)} />
              {column.label}
            </span>
            <span className="font-num text-xs text-muted-foreground">0</span>
          </header>
          <div className="space-y-2.5">
            <GhostTicket />
            {index < 2 && <GhostTicket isFaded />}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatsPreview() {
  const peak = Math.max(...HOURLY_SHAPE);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STAT_TILES.map((label, index) => (
          <div key={label} className={cn("rounded-lg border bg-card p-4", index === 0 && "border-transparent bg-primary text-primary-foreground")}>
            <p className={cn("label-mono", index === 0 ? "text-primary-foreground/60" : "text-muted-foreground")}>{label}</p>
            <p className="mt-3 font-num text-2xl font-medium">—</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="label-mono text-muted-foreground">Ventas por hora</p>
        <div className="mt-4 flex h-28 items-end gap-1.5">
          {HOURLY_SHAPE.map((value, index) => (
            <span
              key={index}
              className={cn("flex-1 rounded-t-sm", value === peak ? "bg-brand/70" : "bg-muted")}
              style={{ height: `${(value / peak) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ListPreview() {
  return (
    <div className="divide-y rounded-lg border bg-card">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className={cn("flex items-center gap-4 px-4 py-3.5", row > 1 && "opacity-50")}>
          <span className="size-8 shrink-0 rounded-md bg-muted" />
          <div className="flex-1 space-y-2">
            <GhostLine className="w-1/3 bg-foreground/15" />
            <GhostLine className="w-1/2" />
          </div>
          <span className="h-5 w-9 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

const PREVIEWS = { board: BoardPreview, stats: StatsPreview, list: ListPreview } as const;

type SectionPreviewProps = {
  kind: keyof typeof PREVIEWS;
  title: string;
  children: ReactNode;
};

/** Forma de la sección con una nota de lo que llegará; el contenido real reemplaza este bloque. */
export function SectionPreview({ kind, title, children }: SectionPreviewProps) {
  const Preview = PREVIEWS[kind];
  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex flex-col gap-1 rounded-lg border border-dashed border-brand/40 bg-brand-soft/50 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
        <span className="label-mono shrink-0 text-brand">Próxima fase</span>
        <p className="text-sm">
          <span className="font-medium">{title}.</span> <span className="text-muted-foreground">{children}</span>
        </p>
      </div>
      <div aria-hidden className="pointer-events-none select-none">
        <Preview />
      </div>
    </section>
  );
}
