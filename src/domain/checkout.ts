import { formatCop } from "../lib/money.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { priceCart, type Cart, type PricedLine } from "./cart.ts";
import type { MenuCatalog } from "./menu.ts";

export const FULFILLMENTS = ["DELIVERY", "PICKUP"] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

export const PAYMENT_METHODS = ["CASH", "TRANSFER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia (Nequi/Daviplata)",
};

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  DELIVERY: "Domicilio",
  PICKUP: "Recoger en el local",
};

export interface StorePolicy {
  readonly deliveryFee: number;
  readonly minOrderAmount: number;
  readonly paymentMethods: readonly PaymentMethod[];
}

/** Datos de entrega y pago que el agente va recolectando; todos opcionales hasta confirmar. */
export interface CheckoutDraft {
  readonly fulfillment?: Fulfillment;
  readonly customerName?: string;
  readonly address?: string;
  readonly addressNotes?: string;
  readonly paymentMethod?: PaymentMethod;
  readonly cashAmount?: number;
  readonly notes?: string;
}

export interface Totals {
  readonly subtotal: number;
  readonly deliveryFee: number;
  readonly total: number;
}

export interface Quote extends Totals {
  readonly lines: readonly PricedLine[];
  readonly fulfillment: Fulfillment;
  readonly customerName: string;
  readonly address?: string;
  readonly addressNotes?: string;
  readonly paymentMethod: PaymentMethod;
  readonly cashAmount?: number;
  readonly notes?: string;
}

export function computeTotals(subtotal: number, fulfillment: Fulfillment, policy: StorePolicy): Totals {
  const deliveryFee = fulfillment === "DELIVERY" ? policy.deliveryFee : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function missingFields(draft: CheckoutDraft, policy: StorePolicy): string[] {
  const errors: string[] = [];
  if (!draft.fulfillment) errors.push("Falta saber si es domicilio o para recoger en el local.");
  if (!draft.customerName?.trim()) errors.push("Falta el nombre de quien recibe el pedido.");
  if (draft.fulfillment === "DELIVERY" && !draft.address?.trim()) errors.push("Falta la dirección de entrega.");
  if (!draft.paymentMethod) {
    errors.push("Falta el método de pago.");
  } else if (!policy.paymentMethods.includes(draft.paymentMethod)) {
    errors.push(`El método de pago ${PAYMENT_LABELS[draft.paymentMethod]} no está disponible.`);
  }
  return errors;
}

/**
 * Valida carrito + datos de entrega y calcula el total definitivo.
 * Devuelve todos los problemas juntos para que el agente pregunte lo que falta de una vez.
 */
export function buildQuote(
  cart: Cart,
  catalog: MenuCatalog,
  draft: CheckoutDraft,
  policy: StorePolicy,
): Result<Quote, string[]> {
  const priced = priceCart(cart, catalog);
  const errors = [...priced.problems];
  if (priced.lines.length === 0 && priced.problems.length === 0) errors.push("El carrito está vacío.");
  errors.push(...missingFields(draft, policy));
  if (errors.length > 0 || !draft.fulfillment || !draft.paymentMethod || !draft.customerName) return err(errors);

  if (draft.fulfillment === "DELIVERY" && priced.subtotal < policy.minOrderAmount) {
    return err([`El pedido mínimo para domicilio es ${formatCop(policy.minOrderAmount)}.`]);
  }
  const totals = computeTotals(priced.subtotal, draft.fulfillment, policy);
  if (draft.paymentMethod === "CASH" && draft.cashAmount !== undefined && draft.cashAmount < totals.total) {
    return err([`El valor con el que paga (${formatCop(draft.cashAmount)}) no cubre el total de ${formatCop(totals.total)}.`]);
  }

  return ok({
    ...totals,
    lines: priced.lines,
    fulfillment: draft.fulfillment,
    customerName: draft.customerName.trim(),
    paymentMethod: draft.paymentMethod,
    ...(draft.fulfillment === "DELIVERY" && draft.address ? { address: draft.address.trim() } : {}),
    ...(draft.fulfillment === "DELIVERY" && draft.addressNotes ? { addressNotes: draft.addressNotes.trim() } : {}),
    ...(draft.paymentMethod === "CASH" && draft.cashAmount !== undefined ? { cashAmount: draft.cashAmount } : {}),
    ...(draft.notes ? { notes: draft.notes.trim() } : {}),
  });
}
