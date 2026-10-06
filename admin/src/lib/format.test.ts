import { describe, expect, it } from "vitest";
import { formatClock, formatCop, formatShortDate } from "./format";

// 6 de octubre de 2026, 17:47 UTC = 12:47 en Bogotá (UTC-5).
const INSTANT = new Date("2026-10-06T17:47:00Z");

describe("formatCop", () => {
  it("formats whole pesos with dot separators", () => {
    expect(formatCop(18500)).toBe("$18.500");
    expect(formatCop(1250000)).toBe("$1.250.000");
  });
});

describe("formatClock", () => {
  it("shows the 24-hour time in the restaurant timezone", () => {
    expect(formatClock(INSTANT, "America/Bogota")).toBe("12:47");
  });
});

describe("formatShortDate", () => {
  it("shows weekday, day and month in Spanish without punctuation", () => {
    expect(formatShortDate(INSTANT, "America/Bogota")).toBe("mar 6 oct");
  });
});
