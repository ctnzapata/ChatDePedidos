import { describe, expect, it } from "vitest";
import {
  describeOpeningHours,
  formatLocalTime,
  isOpenAt,
  localDayRange,
  type OpeningWindow,
} from "../../src/domain/hours.ts";

const TZ = "America/Bogota"; // UTC-5, sin horario de verano

// 2026-10-05 es lunes (día 1).
const mondayAt = (hhmm: string): Date => new Date(`2026-10-05T${hhmm}:00-05:00`);

const everyDay: OpeningWindow[] = [{ days: [0, 1, 2, 3, 4, 5, 6], open: "11:00", close: "22:00" }];

describe("isOpenAt", () => {
  it("is open inside the window in the store timezone", () => {
    expect(isOpenAt(everyDay, mondayAt("11:00"), TZ)).toBe(true);
    expect(isOpenAt(everyDay, mondayAt("21:59"), TZ)).toBe(true);
  });

  it("is closed before opening and at closing time", () => {
    expect(isOpenAt(everyDay, mondayAt("10:59"), TZ)).toBe(false);
    expect(isOpenAt(everyDay, mondayAt("22:00"), TZ)).toBe(false);
  });

  it("is closed on days not listed", () => {
    const weekendsOnly: OpeningWindow[] = [{ days: [0, 6], open: "11:00", close: "22:00" }];

    expect(isOpenAt(weekendsOnly, mondayAt("15:00"), TZ)).toBe(false);
  });

  it("supports windows that cross midnight", () => {
    const lateNight: OpeningWindow[] = [{ days: [5], open: "18:00", close: "02:00" }];
    const friday2330 = new Date("2026-10-09T23:30:00-05:00");
    const saturday0130 = new Date("2026-10-10T01:30:00-05:00");
    const saturday0300 = new Date("2026-10-10T03:00:00-05:00");

    expect(isOpenAt(lateNight, friday2330, TZ)).toBe(true);
    expect(isOpenAt(lateNight, saturday0130, TZ)).toBe(true);
    expect(isOpenAt(lateNight, saturday0300, TZ)).toBe(false);
  });
});

describe("localDayRange", () => {
  it("returns the local calendar day as UTC instants", () => {
    const { start, end } = localDayRange(new Date("2026-10-06T02:00:00Z"), TZ);

    // 2:00 UTC del 6 de octubre son las 21:00 del 5 de octubre en Bogotá.
    expect(start.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-06T05:00:00.000Z");
  });
});

describe("formatLocalTime", () => {
  it("formats the time in the store timezone", () => {
    expect(formatLocalTime(new Date("2026-10-05T19:05:00Z"), TZ)).toBe("lunes 14:05");
  });
});

describe("describeOpeningHours", () => {
  it("describes every-day schedules", () => {
    expect(describeOpeningHours(everyDay)).toBe("Todos los días de 11:00 a 22:00");
  });

  it("lists specific days", () => {
    expect(describeOpeningHours([{ days: [1, 2], open: "08:00", close: "12:00" }])).toBe(
      "lunes, martes de 08:00 a 12:00",
    );
  });
});
