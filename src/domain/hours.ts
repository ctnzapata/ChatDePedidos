import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const openingWindowSchema = z.object({
  /** 0 = domingo ... 6 = sábado */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  open: z.string().regex(HHMM),
  close: z.string().regex(HHMM),
});
export const openingHoursSchema = z.array(openingWindowSchema);
export type OpeningWindow = z.infer<typeof openingWindowSchema>;

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

function toMinutes(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

interface LocalTime {
  readonly day: number;
  readonly minutes: number;
}

function localTime(date: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function isInsideWindow(window: OpeningWindow, now: LocalTime): boolean {
  const open = toMinutes(window.open);
  const close = toMinutes(window.close);
  if (close > open) {
    return window.days.includes(now.day) && now.minutes >= open && now.minutes < close;
  }
  // Horario que cruza la medianoche (p. ej. 18:00 a 02:00).
  const previousDay = (now.day + 6) % 7;
  return (
    (window.days.includes(now.day) && now.minutes >= open) ||
    (window.days.includes(previousDay) && now.minutes < close)
  );
}

/** Hora local (0–23) de un instante en la zona horaria del local. */
export function localHour(date: Date, timeZone: string): number {
  return Math.floor(localTime(date, timeZone).minutes / 60);
}

/** Minutos que la zona horaria está adelantada (+) o atrasada (−) respecto a UTC en ese instante. */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Inicio y fin del día calendario local que contiene `date`, como instantes UTC. */
export function localDayRange(date: Date, timeZone: string): { start: Date; end: Date } {
  const localNow = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60_000);
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  const start = new Date(localMidnight - offsetMinutes(new Date(localMidnight), timeZone) * 60_000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

export function isOpenAt(hours: readonly OpeningWindow[], date: Date, timeZone: string): boolean {
  const now = localTime(date, timeZone);
  return hours.some((window) => isInsideWindow(window, now));
}

/** "lunes 14:05" en la zona horaria del local. */
export function formatLocalTime(date: Date, timeZone: string): string {
  const { day, minutes } = localTime(date, timeZone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${DAY_NAMES[day]} ${hh}:${mm}`;
}

export function describeOpeningHours(hours: readonly OpeningWindow[]): string {
  return hours
    .map((window) => {
      const days =
        new Set(window.days).size === 7
          ? "Todos los días"
          : [...window.days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(", ");
      return `${days} de ${window.open} a ${window.close}`;
    })
    .join("; ");
}
