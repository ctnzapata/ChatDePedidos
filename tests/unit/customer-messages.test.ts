import { describe, expect, it } from "vitest";
import type { Quote } from "../../src/domain/checkout.ts";
import {
  orderConfirmedText,
  renderQuoteSummary,
  staffNewOrderText,
  statusChangedText,
} from "../../src/services/customer-messages.ts";

const quote: Quote = {
  lines: [
    {
      lineId: "L1",
      itemCode: "HAM-SEN",
      name: "Hamburguesa sencilla",
      quantity: 2,
      modifiers: [{ code: "EXT-QUE", name: "Queso extra", price: 3000 }],
      notes: "sin cebolla",
      unitPrice: 21500,
      lineTotal: 43000,
    },
  ],
  subtotal: 43000,
  deliveryFee: 5000,
  total: 48000,
  fulfillment: "DELIVERY",
  customerName: "Ana",
  address: "Cra 10 # 20-30",
  addressNotes: "Apto 301",
  paymentMethod: "CASH",
  cashAmount: 50000,
};

const store = {
  name: "La Esquina Rápida",
  address: "Calle 45 # 23-10",
  prepTimeMinutes: 25,
  deliveryTimeMinutes: 30,
  transferInfo: "Nequi 300 000 0000",
};

describe("renderQuoteSummary", () => {
  const summary = renderQuoteSummary(quote);

  it("lists lines, totals and delivery data", () => {
    expect(summary).toContain("2 x Hamburguesa sencilla + Queso extra (sin cebolla) — $43.000");
    expect(summary).toContain("Domicilio: $5.000");
    expect(summary).toContain("*Total: $48.000*");
    expect(summary).toContain("Cra 10 # 20-30 (Apto 301)");
    expect(summary).toContain("Ana");
  });

  it("includes the change for cash payments", () => {
    expect(summary).toContain("$50.000");
    expect(summary).toContain("cambio: $2.000");
  });

  it("shows the pickup address of the store for pickup orders", () => {
    const pickup = renderQuoteSummary({ ...quote, fulfillment: "PICKUP", deliveryFee: 0, total: 43000, address: undefined });

    expect(pickup).toContain("Recoger en el local");
    expect(pickup).not.toContain("Domicilio: $");
  });
});

describe("orderConfirmedText", () => {
  it("gives the order number and the delivery estimate", () => {
    const text = orderConfirmedText({ number: 12, fulfillment: "DELIVERY", paymentMethod: "CASH", total: 48000 }, store);

    expect(text).toContain("#12");
    expect(text).toContain("55");
  });

  it("includes transfer data when paying by transfer", () => {
    const text = orderConfirmedText({ number: 12, fulfillment: "PICKUP", paymentMethod: "TRANSFER", total: 43000 }, store);

    expect(text).toContain("Nequi 300 000 0000");
    expect(text).toContain("Calle 45 # 23-10");
  });
});

describe("statusChangedText", () => {
  it("returns a message for customer-facing statuses", () => {
    expect(statusChangedText(12, "OUT_FOR_DELIVERY", store.name)).toContain("en camino");
    expect(statusChangedText(12, "READY", store.name)).toContain("listo");
    expect(statusChangedText(12, "REJECTED", store.name)).toContain("no pudimos");
  });

  it("returns null for internal statuses", () => {
    expect(statusChangedText(12, "PENDING", store.name)).toBeNull();
  });
});

describe("staffNewOrderText", () => {
  it("summarizes the order for the staff", () => {
    const text = staffNewOrderText(12, quote, "573001112233");

    expect(text).toContain("Nuevo pedido #12");
    expect(text).toContain("+573001112233");
    expect(text).toContain("$48.000");
  });
});
