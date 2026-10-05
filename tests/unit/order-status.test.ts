import { describe, expect, it } from "vitest";
import { canTransition, isActiveStatus, nextStatuses } from "../../src/domain/order-status.ts";

describe("order status transitions", () => {
  it("allows the happy path for delivery", () => {
    expect(canTransition("PENDING", "ACCEPTED", "DELIVERY")).toBe(true);
    expect(canTransition("ACCEPTED", "PREPARING", "DELIVERY")).toBe(true);
    expect(canTransition("PREPARING", "OUT_FOR_DELIVERY", "DELIVERY")).toBe(true);
    expect(canTransition("OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY")).toBe(true);
  });

  it("allows the happy path for pickup", () => {
    expect(canTransition("PREPARING", "READY", "PICKUP")).toBe(true);
    expect(canTransition("READY", "DELIVERED", "PICKUP")).toBe(true);
  });

  it("does not mix pickup and delivery steps", () => {
    expect(canTransition("PREPARING", "READY", "DELIVERY")).toBe(false);
    expect(canTransition("PREPARING", "OUT_FOR_DELIVERY", "PICKUP")).toBe(false);
  });

  it("does not allow skipping steps or leaving final states", () => {
    expect(canTransition("PENDING", "DELIVERED", "PICKUP")).toBe(false);
    expect(canTransition("DELIVERED", "PREPARING", "PICKUP")).toBe(false);
    expect(canTransition("CANCELLED", "ACCEPTED", "PICKUP")).toBe(false);
  });

  it("allows rejecting only a pending order", () => {
    expect(canTransition("PENDING", "REJECTED", "PICKUP")).toBe(true);
    expect(canTransition("ACCEPTED", "REJECTED", "PICKUP")).toBe(false);
  });

  it("lists the next statuses for the panel", () => {
    expect(nextStatuses("PREPARING", "PICKUP")).toEqual(["READY", "CANCELLED"]);
    expect(nextStatuses("DELIVERED", "PICKUP")).toEqual([]);
  });

  it("knows which statuses are active", () => {
    expect(isActiveStatus("PREPARING")).toBe(true);
    expect(isActiveStatus("DELIVERED")).toBe(false);
    expect(isActiveStatus("CANCELLED")).toBe(false);
  });
});
