import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../../src/lib/rate-limiter.ts";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit inside the window", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(2, 60_000, () => now);

    expect(limiter.check("a")).toEqual({ allowed: true, firstRejection: false });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a")).toEqual({ allowed: false, firstRejection: true });
    expect(limiter.check("a")).toEqual({ allowed: false, firstRejection: false });
    now = 1000;
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("allows again once the window has passed", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(1, 60_000, () => now);
    limiter.check("a");
    limiter.check("a");

    now = 60_001;

    expect(limiter.check("a")).toEqual({ allowed: true, firstRejection: false });
    expect(limiter.check("a")).toEqual({ allowed: false, firstRejection: true });
  });
});
