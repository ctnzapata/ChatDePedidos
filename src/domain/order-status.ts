import type { Fulfillment } from "./checkout.ts";

export const ORDER_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Recibido",
  ACCEPTED: "Aceptado",
  PREPARING: "En preparación",
  READY: "Listo para recoger",
  OUT_FOR_DELIVERY: "En camino",
  DELIVERED: "Entregado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "OUT_FOR_DELIVERY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

const PICKUP_ONLY: readonly OrderStatus[] = ["READY"];
const DELIVERY_ONLY: readonly OrderStatus[] = ["OUT_FOR_DELIVERY"];

function appliesTo(status: OrderStatus, fulfillment: Fulfillment): boolean {
  if (fulfillment === "PICKUP") return !DELIVERY_ONLY.includes(status);
  return !PICKUP_ONLY.includes(status);
}

export function nextStatuses(from: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => appliesTo(to, fulfillment));
}

export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  return nextStatuses(from, fulfillment).includes(to);
}

export function isActiveStatus(status: OrderStatus): boolean {
  return TRANSITIONS[status].length > 0;
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}
