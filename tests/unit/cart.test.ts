import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  MAX_QUANTITY_PER_LINE,
  addToCart,
  priceCart,
  renderPricedCart,
  updateLineQuantity,
  type Cart,
} from "../../src/domain/cart.ts";
import { catalog } from "../fixtures/catalog.ts";

function mustAdd(cart: Cart, input: Parameters<typeof addToCart>[2]): Cart {
  const result = addToCart(cart, catalog, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("addToCart", () => {
  it("adds a line with a sequential id and does not mutate the original cart", () => {
    const cart = mustAdd(EMPTY_CART, { itemCode: "HAM-SEN", quantity: 2, modifierCodes: [] });

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ lineId: "L1", itemCode: "HAM-SEN", quantity: 2 });
    expect(EMPTY_CART.lines).toHaveLength(0);
  });

  it("normalizes codes to uppercase", () => {
    const cart = mustAdd(EMPTY_CART, { itemCode: "ham-sen", quantity: 1, modifierCodes: ["ext-que"] });

    expect(cart.lines[0]).toMatchObject({ itemCode: "HAM-SEN", modifierCodes: ["EXT-QUE"] });
  });

  it("rejects unknown items", () => {
    const result = addToCart(EMPTY_CART, catalog, { itemCode: "XXX", quantity: 1, modifierCodes: [] });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("XXX") });
  });

  it("rejects unavailable items", () => {
    const result = addToCart(EMPTY_CART, catalog, { itemCode: "BEB-LIM", quantity: 1, modifierCodes: [] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("agotado");
  });

  it("rejects extras that do not belong to the item", () => {
    const result = addToCart(EMPTY_CART, catalog, { itemCode: "BEB-GAS", quantity: 1, modifierCodes: ["EXT-QUE"] });

    expect(result.ok).toBe(false);
  });

  it("rejects unavailable extras", () => {
    const result = addToCart(EMPTY_CART, catalog, { itemCode: "HAM-SEN", quantity: 1, modifierCodes: ["EXT-GUA"] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("agotad");
  });

  it("rejects duplicated extras", () => {
    const result = addToCart(EMPTY_CART, catalog, {
      itemCode: "HAM-SEN",
      quantity: 1,
      modifierCodes: ["EXT-QUE", "EXT-QUE"],
    });

    expect(result.ok).toBe(false);
  });

  it.each([0, -1, 1.5, MAX_QUANTITY_PER_LINE + 1])("rejects invalid quantity %s", (quantity) => {
    const result = addToCart(EMPTY_CART, catalog, { itemCode: "HAM-SEN", quantity, modifierCodes: [] });

    expect(result.ok).toBe(false);
  });
});

describe("updateLineQuantity", () => {
  const cart = mustAdd(
    mustAdd(EMPTY_CART, { itemCode: "HAM-SEN", quantity: 1, modifierCodes: [] }),
    { itemCode: "BEB-GAS", quantity: 1, modifierCodes: [] },
  );

  it("changes the quantity of a line", () => {
    const result = updateLineQuantity(cart, "L2", 3);

    expect(result.ok && result.value.lines[1]?.quantity).toBe(3);
    expect(cart.lines[1]?.quantity).toBe(1);
  });

  it("removes the line when quantity is 0", () => {
    const result = updateLineQuantity(cart, "L1", 0);

    expect(result.ok && result.value.lines.map((l) => l.lineId)).toEqual(["L2"]);
  });

  it("rejects unknown lines", () => {
    expect(updateLineQuantity(cart, "L9", 1).ok).toBe(false);
  });

  it("rejects invalid quantities", () => {
    expect(updateLineQuantity(cart, "L1", -2).ok).toBe(false);
  });
});

describe("priceCart", () => {
  it("computes unit price with extras, line totals and subtotal", () => {
    const cart = mustAdd(
      mustAdd(EMPTY_CART, { itemCode: "HAM-SEN", quantity: 2, modifierCodes: ["EXT-QUE", "EXT-TOC"] }),
      { itemCode: "BEB-GAS", quantity: 2, modifierCodes: [], notes: "Coca-Cola" },
    );

    const priced = priceCart(cart, catalog);

    expect(priced.lines[0]).toMatchObject({ unitPrice: 25500, lineTotal: 51000 });
    expect(priced.lines[1]).toMatchObject({ unitPrice: 4000, lineTotal: 8000, notes: "Coca-Cola" });
    expect(priced.subtotal).toBe(59000);
    expect(priced.problems).toEqual([]);
  });

  it("reports lines whose item became unavailable and excludes them from the subtotal", () => {
    const cart: Cart = {
      nextLineNumber: 2,
      lines: [{ lineId: "L1", itemCode: "BEB-LIM", quantity: 1, modifierCodes: [] }],
    };

    const priced = priceCart(cart, catalog);

    expect(priced.subtotal).toBe(0);
    expect(priced.problems[0]).toContain("Limonada de coco");
  });

  it("reports lines whose item no longer exists", () => {
    const cart: Cart = {
      nextLineNumber: 2,
      lines: [{ lineId: "L1", itemCode: "OLD-ITEM", quantity: 1, modifierCodes: [] }],
    };

    expect(priceCart(cart, catalog).problems).toHaveLength(1);
  });
});

describe("renderPricedCart", () => {
  it("renders lines with ids, extras, notes and the subtotal", () => {
    const cart = mustAdd(EMPTY_CART, {
      itemCode: "HAM-SEN",
      quantity: 1,
      modifierCodes: ["EXT-QUE"],
      notes: "sin cebolla",
    });

    const text = renderPricedCart(priceCart(cart, catalog));

    expect(text).toContain("L1: 1 x Hamburguesa sencilla");
    expect(text).toContain("Queso extra");
    expect(text).toContain("sin cebolla");
    expect(text).toContain("$21.500");
  });

  it("says the cart is empty", () => {
    expect(renderPricedCart(priceCart(EMPTY_CART, catalog))).toContain("vacío");
  });
});
