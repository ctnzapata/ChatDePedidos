import { describe, expect, it } from "vitest";
import { findItem, renderMenuText } from "../../src/domain/menu.ts";
import { catalog } from "../fixtures/catalog.ts";

describe("findItem", () => {
  it("finds an item by code ignoring case and spaces", () => {
    expect(findItem(catalog, " ham-sen ")?.name).toBe("Hamburguesa sencilla");
  });

  it("returns undefined for unknown codes", () => {
    expect(findItem(catalog, "NOPE")).toBeUndefined();
  });
});

describe("renderMenuText", () => {
  const text = renderMenuText(catalog);

  it("groups items by category with codes and COP prices", () => {
    expect(text).toContain("## Hamburguesas");
    expect(text).toContain("[HAM-SEN] Hamburguesa sencilla — $18.500");
    expect(text).toContain("## Bebidas");
  });

  it("lists extras with their price", () => {
    expect(text).toContain("[EXT-QUE] Queso extra +$3.000");
  });

  it("marks unavailable items and extras as AGOTADO", () => {
    expect(text).toContain("[BEB-LIM] Limonada de coco — $9.000 (AGOTADO)");
    expect(text).toContain("[EXT-GUA] Guacamole +$3.500 (AGOTADO)");
  });
});
