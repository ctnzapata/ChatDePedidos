import { describe, expect, it } from "vitest";
import { formatCop } from "../../src/lib/money.ts";

describe("formatCop", () => {
  it("formats thousands with dots and no decimals", () => {
    expect(formatCop(18500)).toBe("$18.500");
  });

  it("formats millions", () => {
    expect(formatCop(1234567)).toBe("$1.234.567");
  });

  it("formats small amounts and zero", () => {
    expect(formatCop(900)).toBe("$900");
    expect(formatCop(0)).toBe("$0");
  });
});
