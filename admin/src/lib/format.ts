/** Pesos colombianos sin decimales: 18500 -> "$18.500". */
export function formatCop(amount: number): string {
  return `$${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Hora en formato 24 h en la zona del restaurante: "12:47". */
export function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Fecha corta sin puntuación: "mar 6 oct". */
export function formatShortDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("es-CO", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value.replace(/\./g, "").toLowerCase() ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "·";
}
