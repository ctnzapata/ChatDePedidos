import { describe, expect, it } from "vitest";
import { authorize, can, type Membership } from "../../src/auth/permissions.ts";

const membership = (restaurantId: string, role: Membership["role"]): Membership => ({
  staffId: `staff-${restaurantId}-${role}`,
  restaurantId,
  restaurantName: `Local ${restaurantId}`,
  role,
  displayName: role,
});

describe("can", () => {
  it("lets the owner do everything", () => {
    for (const permission of ["orders:manage", "team:manage", "metrics:read", "settings:manage", "store:pause"] as const) {
      expect(can("OWNER", permission)).toBe(true);
    }
  });

  it("lets staff run day-to-day operations but not manage the team, settings or metrics", () => {
    expect(can("STAFF", "orders:manage")).toBe(true);
    expect(can("STAFF", "menu:availability")).toBe(true);
    expect(can("STAFF", "conversations:manage")).toBe(true);
    expect(can("STAFF", "store:pause")).toBe(true);
    expect(can("STAFF", "team:manage")).toBe(false);
    expect(can("STAFF", "settings:manage")).toBe(false);
    expect(can("STAFF", "metrics:read")).toBe(false);
  });

  it("limits couriers to their own deliveries", () => {
    expect(can("COURIER", "deliveries:own")).toBe(true);
    expect(can("COURIER", "orders:read")).toBe(false);
    expect(can("COURIER", "orders:manage")).toBe(false);
    expect(can("COURIER", "menu:availability")).toBe(false);
  });
});

describe("authorize", () => {
  const memberships = [membership("A", "STAFF"), membership("B", "COURIER")];

  it("returns the membership when the role has the permission in that restaurant", () => {
    expect(authorize(memberships, "A", "orders:manage")).toEqual({ ok: true, value: memberships[0] });
  });

  it("rejects users who are not members of the restaurant", () => {
    expect(authorize(memberships, "C", "orders:read")).toEqual({ ok: false, error: "NOT_MEMBER" });
  });

  it("rejects members whose role lacks the permission", () => {
    expect(authorize(memberships, "B", "orders:read")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(authorize(memberships, "A", "team:manage")).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
