import { describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart, type Cart } from "../../src/domain/cart.ts";
import { buildQuote, computeTotals, type CheckoutDraft } from "../../src/domain/checkout.ts";
import { catalog, policy } from "../fixtures/catalog.ts";

function cartWith(itemCode: string, quantity: number): Cart {
  const result = addToCart(EMPTY_CART, catalog, { itemCode, quantity, modifierCodes: [] });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const delivery: CheckoutDraft = {
  fulfillment: "DELIVERY",
  customerName: "Ana",
  address: "Cra 10 # 20-30",
  paymentMethod: "TRANSFER",
};

const pickup: CheckoutDraft = {
  fulfillment: "PICKUP",
  customerName: "Ana",
  paymentMethod: "CASH",
};

describe("computeTotals", () => {
  it("adds the delivery fee only for delivery", () => {
    expect(computeTotals(20000, "DELIVERY", policy)).toEqual({ subtotal: 20000, deliveryFee: 5000, total: 25000 });
    expect(computeTotals(20000, "PICKUP", policy)).toEqual({ subtotal: 20000, deliveryFee: 0, total: 20000 });
  });
});

describe("buildQuote", () => {
  it("builds a delivery quote with totals", () => {
    const result = buildQuote(cartWith("HAM-SEN", 1), catalog, delivery, policy);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({ subtotal: 18500, deliveryFee: 5000, total: 23500 });
  });

  it("fails when the cart is empty", () => {
    const result = buildQuote(EMPTY_CART, catalog, delivery, policy);

    expect(!result.ok && result.error.join(" ")).toContain("vacío");
  });

  it("requires a delivery address for delivery", () => {
    const result = buildQuote(cartWith("HAM-SEN", 1), catalog, { ...delivery, address: undefined }, policy);

    expect(!result.ok && result.error.join(" ")).toContain("dirección");
  });

  it("does not require an address for pickup", () => {
    expect(buildQuote(cartWith("BEB-GAS", 1), catalog, pickup, policy).ok).toBe(true);
  });

  it("enforces the minimum order for delivery only", () => {
    const smallCart = cartWith("BEB-GAS", 1);

    const deliveryResult = buildQuote(smallCart, catalog, delivery, policy);

    expect(!deliveryResult.ok && deliveryResult.error.join(" ")).toContain("$15.000");
    expect(buildQuote(smallCart, catalog, pickup, policy).ok).toBe(true);
  });

  it("lists every missing field at once", () => {
    const result = buildQuote(cartWith("HAM-SEN", 1), catalog, {}, policy);

    expect(!result.ok && result.error.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects payment methods the store does not accept", () => {
    const result = buildQuote(cartWith("HAM-SEN", 1), catalog, delivery, { ...policy, paymentMethods: ["CASH"] });

    expect(result.ok).toBe(false);
  });

  it("requires cash amount to cover the total when paying cash", () => {
    const cart = cartWith("HAM-SEN", 1);

    const tooLittle = buildQuote(cart, catalog, { ...pickup, cashAmount: 10000 }, policy);

    expect(tooLittle.ok).toBe(false);
    expect(buildQuote(cart, catalog, { ...pickup, cashAmount: 50000 }, policy).ok).toBe(true);
  });

  it("fails when a cart line is no longer available", () => {
    const cart: Cart = {
      nextLineNumber: 2,
      lines: [{ lineId: "L1", itemCode: "BEB-LIM", quantity: 1, modifierCodes: [] }],
    };

    expect(buildQuote(cart, catalog, pickup, policy).ok).toBe(false);
  });
});
