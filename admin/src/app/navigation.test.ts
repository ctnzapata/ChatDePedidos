import { describe, expect, it } from "vitest";
import type { Permission } from "@/lib/types";
import { homePathFor, navigationFor } from "./navigation";

const STAFF: Permission[] = ["orders:read", "orders:manage", "menu:availability", "store:pause", "conversations:manage"];
const OWNER: Permission[] = [...STAFF, "team:manage", "metrics:read", "settings:manage"];
const COURIER: Permission[] = ["deliveries:own"];

const paths = (permissions: Permission[]): string[] => navigationFor(permissions).map((item) => item.to);

describe("navigationFor", () => {
  it("shows the owner every back-office section, but not the courier view", () => {
    expect(paths(OWNER)).toEqual(["/", "/pedidos", "/menu", "/atencion", "/equipo", "/ajustes"]);
  });

  it("shows staff only day-to-day sections", () => {
    expect(paths(STAFF)).toEqual(["/pedidos", "/menu", "/atencion"]);
  });

  it("shows couriers only their deliveries", () => {
    expect(paths(COURIER)).toEqual(["/entregas"]);
  });
});

describe("homePathFor", () => {
  it("lands each role on its first available section", () => {
    expect(homePathFor(OWNER)).toBe("/");
    expect(homePathFor(STAFF)).toBe("/pedidos");
    expect(homePathFor(COURIER)).toBe("/entregas");
  });

  it("falls back to the no-access page without permissions", () => {
    expect(homePathFor([])).toBe("/sin-acceso");
  });
});
