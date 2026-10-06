import { describe, expect, it } from "vitest";
import type { Permission } from "@/lib/types";
import { homePathFor, navigationFor, navigationGroupsFor, sectionFor } from "./navigation";

const STAFF: Permission[] = ["orders:read", "orders:manage", "menu:availability", "store:pause", "conversations:manage"];
const OWNER: Permission[] = [...STAFF, "team:manage", "metrics:read", "settings:manage"];
const COURIER: Permission[] = ["deliveries:own"];

const paths = (permissions: Permission[]): string[] => navigationFor(permissions).map((item) => item.to);

describe("navigationFor", () => {
  it("shows the owner every back-office section, but not the courier view", () => {
    expect(paths(OWNER)).toEqual(["/", "/pedidos", "/atencion", "/menu", "/equipo", "/ajustes"]);
  });

  it("shows staff only day-to-day sections", () => {
    expect(paths(STAFF)).toEqual(["/pedidos", "/atencion", "/menu"]);
  });

  it("shows couriers only their deliveries", () => {
    expect(paths(COURIER)).toEqual(["/entregas"]);
  });
});

const groups = (permissions: Permission[]) =>
  navigationGroupsFor(permissions).map((group) => [group.label, group.items.map((item) => item.to)]);

describe("navigationGroupsFor", () => {
  it("groups the owner's sections in sidebar order", () => {
    expect(groups(OWNER)).toEqual([
      ["Operación", ["/", "/pedidos", "/atencion"]],
      ["Catálogo", ["/menu"]],
      ["Administración", ["/equipo", "/ajustes"]],
    ]);
  });

  it("omits groups the role cannot see", () => {
    expect(groups(STAFF)).toEqual([
      ["Operación", ["/pedidos", "/atencion"]],
      ["Catálogo", ["/menu"]],
    ]);
    expect(groups(COURIER)).toEqual([["Operación", ["/entregas"]]]);
  });
});

describe("sectionFor", () => {
  it("finds the section of a path, including nested paths", () => {
    expect(sectionFor("/")?.label).toBe("Resumen");
    expect(sectionFor("/pedidos")?.label).toBe("Pedidos");
    expect(sectionFor("/equipo/123")?.label).toBe("Equipo");
  });

  it("returns undefined for unknown paths", () => {
    expect(sectionFor("/no-existe")).toBeUndefined();
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
