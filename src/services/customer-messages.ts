import { renderPricedLine } from "../domain/cart.ts";
import { FULFILLMENT_LABELS, PAYMENT_LABELS, type Fulfillment, type PaymentMethod, type Quote } from "../domain/checkout.ts";
import type { OrderStatus } from "../domain/order-status.ts";
import { formatCop } from "../lib/money.ts";
import type { ReplyButton } from "../whatsapp/messenger.ts";

export const CONFIRM_BUTTON_ID = "confirm_order";
export const EDIT_BUTTON_ID = "edit_order";

export const CONFIRMATION_BUTTONS: readonly ReplyButton[] = [
  { id: CONFIRM_BUTTON_ID, title: "Confirmar pedido" },
  { id: EDIT_BUTTON_ID, title: "Modificar" },
];

export const UNSUPPORTED_MESSAGE_TEXT = "Por ahora solo puedo leer mensajes de texto 🙏 ¿Me escribes lo que necesitas?";
export const TECHNICAL_ERROR_TEXT = "Tuvimos un problema técnico 😓 Intenta de nuevo en un momento, por favor.";
export const EDIT_ORDER_REPLY = "¡Claro! Cuéntame qué quieres cambiar 😊";
export const NO_PENDING_CONFIRMATION_TEXT =
  "No tengo un pedido pendiente por confirmar. Cuéntame qué quieres pedir y lo armamos 😊";
export const ORDERS_PAUSED_TEXT =
  "En este momento no estamos recibiendo pedidos 😔 Intenta de nuevo un poco más tarde, por favor.";
export const STAFF_GREETING_TEXT =
  "Hola equipo 👋 Este es el número del asistente. Los pedidos nuevos llegan por aquí y al panel.";
export const RATE_LIMITED_TEXT = "Vas muy rápido 😅 Espera un minuto y me sigues contando, por favor.";

/** Los mensajes reenviados al personal se recortan para evitar spam. */
export const MAX_FORWARDED_TEXT_LENGTH = 500;

export function storeClosedText(openingHoursText: string): string {
  return `En este momento el local está cerrado 😔 Nuestro horario: ${openingHoursText}. ¡Te esperamos!`;
}

export interface StoreInfo {
  readonly name: string;
  readonly address: string;
  readonly prepTimeMinutes: number;
  readonly deliveryTimeMinutes: number;
  readonly transferInfo: string | null;
}

export interface ConfirmedOrderInfo {
  readonly number: number;
  readonly fulfillment: Fulfillment;
  readonly paymentMethod: PaymentMethod;
  readonly total: number;
}

function paymentLine(method: PaymentMethod, total: number, cashAmount: number | undefined): string {
  if (method === "CASH" && cashAmount !== undefined && cashAmount > total) {
    return `💵 Pago: Efectivo — pagas con ${formatCop(cashAmount)} (cambio: ${formatCop(cashAmount - total)})`;
  }
  return `${method === "CASH" ? "💵" : "💳"} Pago: ${PAYMENT_LABELS[method]}`;
}

function deliveryLine(quote: Quote): string {
  if (quote.fulfillment === "PICKUP") return `🏪 ${FULFILLMENT_LABELS.PICKUP}`;
  const notes = quote.addressNotes ? ` (${quote.addressNotes})` : "";
  return `🛵 Domicilio a: ${quote.address ?? ""}${notes}`;
}

export function renderQuoteSummary(quote: Quote): string {
  const totals = [
    `Subtotal: ${formatCop(quote.subtotal)}`,
    ...(quote.fulfillment === "DELIVERY" ? [`Domicilio: ${formatCop(quote.deliveryFee)}`] : []),
    `*Total: ${formatCop(quote.total)}*`,
  ];
  return [
    "🧾 *Resumen de tu pedido*",
    ...quote.lines.map(renderPricedLine),
    "",
    ...totals,
    "",
    deliveryLine(quote),
    `👤 A nombre de: ${quote.customerName}`,
    paymentLine(quote.paymentMethod, quote.total, quote.cashAmount),
    ...(quote.notes ? [`📝 Notas: ${quote.notes}`] : []),
  ].join("\n");
}

export function confirmationPrompt(total: number): string {
  return `¿Confirmamos tu pedido por *${formatCop(total)}*?`;
}

export function quoteChangedText(total: number): string {
  return `Ojo: el total de tu pedido cambió a *${formatCop(total)}* (el menú se actualizó). Revisa el nuevo resumen, por favor.`;
}

export function orderConfirmedText(order: ConfirmedOrderInfo, store: StoreInfo): string {
  const eta =
    order.fulfillment === "DELIVERY"
      ? `⏱️ Tiempo estimado de entrega: unos ${store.prepTimeMinutes + store.deliveryTimeMinutes} minutos.`
      : `⏱️ Podrás recogerlo en unos ${store.prepTimeMinutes} minutos en ${store.address}.`;
  const transfer =
    order.paymentMethod === "TRANSFER" && store.transferInfo
      ? [`💳 Transfiere ${formatCop(order.total)} a: ${store.transferInfo}. Ten a mano el comprobante al recibir tu pedido.`]
      : [];
  return [
    `✅ ¡Recibimos tu pedido *#${order.number}*! El restaurante lo confirmará en un momento.`,
    eta,
    ...transfer,
    "Te iré avisando por este chat cómo va tu pedido.",
  ].join("\n");
}

const STATUS_MESSAGES: Partial<Record<OrderStatus, (n: number, store: string) => string>> = {
  ACCEPTED: (n, store) => `👍 ¡${store} aceptó tu pedido #${n}!`,
  PREPARING: (n) => `👨‍🍳 Tu pedido #${n} está en preparación.`,
  READY: (n) => `🎉 ¡Tu pedido #${n} está listo para recoger!`,
  OUT_FOR_DELIVERY: (n) => `🛵 ¡Tu pedido #${n} va en camino!`,
  DELIVERED: (n, store) => `¡Pedido #${n} entregado! Gracias por pedir en ${store} ❤️`,
  REJECTED: (n) => `😔 Lo sentimos, no pudimos aceptar tu pedido #${n}. Si quieres, escríbenos y te ayudamos.`,
  CANCELLED: (n) => `Tu pedido #${n} fue cancelado.`,
};

/** Mensaje para el cliente cuando cambia el estado de su pedido; null si no se debe avisar. */
export function statusChangedText(orderNumber: number, status: OrderStatus, storeName: string): string | null {
  return STATUS_MESSAGES[status]?.(orderNumber, storeName) ?? null;
}

export function staffNewOrderText(orderNumber: number, quote: Quote, customerPhone: string): string {
  const destination =
    quote.fulfillment === "DELIVERY"
      ? `Domicilio: ${quote.address ?? ""}${quote.addressNotes ? ` (${quote.addressNotes})` : ""}`
      : FULFILLMENT_LABELS.PICKUP;
  return [
    `🔔 *Nuevo pedido #${orderNumber}*`,
    `Cliente: ${quote.customerName} (+${customerPhone})`,
    destination,
    paymentLine(quote.paymentMethod, quote.total, quote.cashAmount),
    ...quote.lines.map((line) => `- ${renderPricedLine(line)}`),
    `*Total: ${formatCop(quote.total)}*`,
    // Lo escribe el cliente (vía el agente): no son instrucciones del negocio.
    ...(quote.notes ? [`Nota del cliente (sin verificar): ${quote.notes}`] : []),
    "Gestiónalo en el panel.",
  ].join("\n");
}

export function staffHandoffText(customerName: string, customerPhone: string, reason: string): string {
  return [
    `🙋 *${customerName}* (+${customerPhone}) necesita atención de una persona.`,
    `Motivo: ${reason}`,
    "El asistente quedó en pausa con este cliente. Reactívalo desde el panel cuando terminen.",
  ].join("\n");
}

export function staffForwardText(customerName: string, customerPhone: string, text: string): string {
  const clipped = text.length > MAX_FORWARDED_TEXT_LENGTH ? `${text.slice(0, MAX_FORWARDED_TEXT_LENGTH)}…` : text;
  return `💬 ${customerName} (+${customerPhone}) escribió: ${clipped}`;
}
