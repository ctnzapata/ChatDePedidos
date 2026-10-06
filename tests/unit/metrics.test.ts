import { describe, expect, it } from "vitest";
import { summarizeDay, type OrderForMetrics } from "../../src/domain/metrics.ts";

const TZ = "America/Bogota";
const at = (hhmm: string): Date => new Date(`2026-10-06T${hhmm}:00-05:00`);

const order = (overrides: Partial<OrderForMetrics>): OrderForMetrics => ({
  status: "DELIVERED",
  total: 20000,
  createdAt: at("12:00"),
  items: [{ name: "Hamburguesa sencilla", quantity: 1 }],
  ...overrides,
});

describe("summarizeDay", () => {
  it("returns zeros for a day without orders", () => {
    const summary = summarizeDay([], TZ);

    expect(summary).toMatchObject({ ordersCount: 0, revenue: 0, averageTicket: 0, activeCount: 0, topItems: [] });
    expect(summary.revenueByHour).toHaveLength(24);
  });

  it("counts orders, revenue and the average ticket, excluding rejected and cancelled", () => {
    const summary = summarizeDay(
      [
        order({ total: 20000 }),
        order({ total: 30000, status: "PREPARING" }),
        order({ total: 99000, status: "CANCELLED" }),
        order({ total: 99000, status: "REJECTED" }),
      ],
      TZ,
    );

    expect(summary).toMatchObject({ ordersCount: 2, revenue: 50000, averageTicket: 25000, activeCount: 1 });
  });

  it("groups revenue by local hour", () => {
    const summary = summarizeDay([order({ createdAt: at("12:15") }), order({ createdAt: at("12:45") }), order({ createdAt: at("19:05") })], TZ);

    expect(summary.revenueByHour[12]).toBe(40000);
    expect(summary.revenueByHour[19]).toBe(20000);
  });

  it("ranks the top items by quantity", () => {
    const summary = summarizeDay(
      [
        order({ items: [{ name: "Combo hamburguesa", quantity: 2 }, { name: "Gaseosa", quantity: 1 }] }),
        order({ items: [{ name: "Combo hamburguesa", quantity: 1 }, { name: "Gaseosa", quantity: 3 }] }),
        order({ items: [{ name: "Perro sencillo", quantity: 1 }] }),
      ],
      TZ,
    );

    expect(summary.topItems).toEqual([
      { name: "Gaseosa", quantity: 4 },
      { name: "Combo hamburguesa", quantity: 3 },
      { name: "Perro sencillo", quantity: 1 },
    ]);
  });
});
