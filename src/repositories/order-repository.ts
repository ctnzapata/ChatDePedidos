import type { Order, OrderItem, Customer } from "@prisma/client";
import { z } from "zod";
import type { OrderSummary } from "../agent/tools.ts";
import { isRetryableWriteError, type Db } from "../db/client.ts";
import { KeyedSerialQueue } from "../lib/keyed-queue.ts";
import type { Fulfillment, PaymentMethod, Quote } from "../domain/checkout.ts";
import { canTransition, isActiveStatus, isOrderStatus, nextStatuses, type OrderStatus, ORDER_STATUSES } from "../domain/order-status.ts";
import { err, ok, type Result } from "../lib/result.ts";

export interface PanelOrderItem {
  readonly name: string;
  readonly quantity: number;
  readonly modifiers: readonly string[];
  readonly notes: string | null;
  readonly lineTotal: number;
}

export interface PanelOrder {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly fulfillment: Fulfillment;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly address: string | null;
  readonly addressNotes: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly cashAmount: number | null;
  readonly notes: string | null;
  readonly subtotal: number;
  readonly deliveryFee: number;
  readonly total: number;
  readonly createdAt: Date;
  readonly items: readonly PanelOrderItem[];
  readonly nextStatuses: readonly OrderStatus[];
}

export interface TransitionError {
  readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "CONFLICT";
  readonly message: string;
}

/** Estado de la conversación que se guarda en la misma transacción que el pedido. */
export interface ConversationSnapshot {
  readonly conversationId: string;
  readonly state: string;
  readonly history: string;
}

export interface CreateOrderInput {
  readonly restaurantId: string;
  readonly customerId: string;
  readonly quote: Quote;
  /** Se llama con el número asignado; si se da, pedido y conversación se guardan juntos o no se guarda nada. */
  readonly conversationAfterCreate?: (orderNumber: number) => ConversationSnapshot;
}

const RECENT_ORDERS_LIMIT = 3;
const PANEL_ORDERS_LIMIT = 100;
const CREATE_ATTEMPTS = 3;
const ACTIVE_STATUSES = ORDER_STATUSES.filter(isActiveStatus);

const modifiersSchema = z.array(z.object({ code: z.string(), name: z.string(), price: z.number() }));

type OrderWithRelations = Order & { items: OrderItem[]; customer: Customer };

function parseModifierNames(raw: string): string[] {
  try {
    const parsed = modifiersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.map((m) => m.name) : [];
  } catch {
    return [];
  }
}

function asStatus(value: string): OrderStatus {
  if (!isOrderStatus(value)) throw new Error(`Estado de pedido desconocido: ${value}`);
  return value;
}

const asFulfillment = (value: string): Fulfillment => (value === "DELIVERY" ? "DELIVERY" : "PICKUP");
const asPaymentMethod = (value: string): PaymentMethod => (value === "TRANSFER" ? "TRANSFER" : "CASH");

function toPanelOrder(row: OrderWithRelations): PanelOrder {
  const status = asStatus(row.status);
  const fulfillment = asFulfillment(row.fulfillment);
  return {
    id: row.id,
    number: row.number,
    status,
    fulfillment,
    customerId: row.customerId,
    customerName: row.customerName,
    customerPhone: row.customer.phone,
    address: row.address,
    addressNotes: row.addressNotes,
    paymentMethod: asPaymentMethod(row.paymentMethod),
    cashAmount: row.cashAmount,
    notes: row.notes,
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    total: row.total,
    createdAt: row.createdAt,
    items: row.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      modifiers: parseModifierNames(item.modifiers),
      notes: item.notes,
      lineTotal: item.lineTotal,
    })),
    nextStatuses: nextStatuses(status, fulfillment),
  };
}

function toSummary(row: Order & { items: OrderItem[] }): OrderSummary {
  return {
    number: row.number,
    status: asStatus(row.status),
    total: row.total,
    fulfillment: asFulfillment(row.fulfillment),
    createdAt: row.createdAt,
    itemsText: row.items.map((item) => `${item.quantity} x ${item.name}`).join(", "),
  };
}

export class OrderRepository {
  // Serializa la creación por restaurante (un solo proceso) para que los consecutivos no choquen.
  private readonly createQueue = new KeyedSerialQueue();

  constructor(private readonly db: Db) {}

  /** Crea el pedido con el siguiente consecutivo del restaurante, reintentando si dos escrituras chocan. */
  createFromQuote(input: CreateOrderInput): Promise<{ id: string; number: number }> {
    return this.createQueue.run(input.restaurantId, () => this.createWithRetry(input));
  }

  private async createWithRetry({
    restaurantId,
    customerId,
    quote,
    conversationAfterCreate,
  }: CreateOrderInput): Promise<{ id: string; number: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const last = await tx.order.aggregate({ where: { restaurantId }, _max: { number: true } });
          const number = (last._max.number ?? 0) + 1;
          const order = await tx.order.create({
            data: {
              restaurantId,
              customerId,
              number,
              status: "PENDING",
              fulfillment: quote.fulfillment,
              address: quote.address ?? null,
              addressNotes: quote.addressNotes ?? null,
              customerName: quote.customerName,
              paymentMethod: quote.paymentMethod,
              cashAmount: quote.cashAmount ?? null,
              notes: quote.notes ?? null,
              subtotal: quote.subtotal,
              deliveryFee: quote.deliveryFee,
              total: quote.total,
              items: {
                create: quote.lines.map((line) => ({
                  itemCode: line.itemCode,
                  name: line.name,
                  unitPrice: line.unitPrice,
                  quantity: line.quantity,
                  modifiers: JSON.stringify(line.modifiers),
                  notes: line.notes ?? null,
                  lineTotal: line.lineTotal,
                })),
              },
            },
          });
          if (conversationAfterCreate) {
            const snapshot = conversationAfterCreate(number);
            await tx.conversation.update({
              where: { id: snapshot.conversationId },
              data: { state: snapshot.state, history: snapshot.history },
            });
          }
          return { id: order.id, number: order.number };
        });
      } catch (error: unknown) {
        if (!isRetryableWriteError(error) || attempt >= CREATE_ATTEMPTS) throw error;
      }
    }
  }

  async listRecentForCustomer(customerId: string): Promise<OrderSummary[]> {
    const rows = await this.db.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: RECENT_ORDERS_LIMIT,
      include: { items: true },
    });
    return rows.map(toSummary);
  }

  /** El cliente solo puede cancelar pedidos que el restaurante aún no aceptó. */
  async cancelByCustomer(customerId: string, orderNumber: number): Promise<Result<OrderSummary>> {
    const order = await this.db.order.findFirst({ where: { customerId, number: orderNumber }, include: { items: true } });
    if (!order) return err(`No encontré el pedido #${orderNumber} de este cliente.`);
    if (order.status !== "PENDING") {
      return err(`El pedido #${orderNumber} ya fue aceptado o finalizó; para cambios hay que hablar con el restaurante.`);
    }
    // Condicionado al estado: si el restaurante lo aceptó entre la lectura y la escritura, no se cancela.
    const updated = await this.db.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return err(`El pedido #${orderNumber} acaba de ser aceptado; para cambios hay que hablar con el restaurante.`);
    }
    return ok(toSummary({ ...order, status: "CANCELLED" }));
  }

  async listForPanel(restaurantId: string, includeClosed: boolean): Promise<PanelOrder[]> {
    const rows = await this.db.order.findMany({
      where: { restaurantId, ...(includeClosed ? {} : { status: { in: [...ACTIVE_STATUSES] } }) },
      orderBy: { createdAt: "desc" },
      take: PANEL_ORDERS_LIMIT,
      include: { items: true, customer: true },
    });
    return rows.map(toPanelOrder);
  }

  async transition(restaurantId: string, orderId: string, to: OrderStatus): Promise<Result<PanelOrder, TransitionError>> {
    const order = await this.db.order.findFirst({ where: { id: orderId, restaurantId } });
    if (!order) return err({ code: "NOT_FOUND", message: "Pedido no encontrado." });
    const from = asStatus(order.status);
    if (!canTransition(from, to, asFulfillment(order.fulfillment))) {
      return err({ code: "INVALID_TRANSITION", message: `No se puede pasar de ${from} a ${to}.` });
    }
    // updateMany con el estado anterior evita pisar un cambio hecho al mismo tiempo desde otra pestaña.
    const updated = await this.db.order.updateMany({ where: { id: orderId, status: from }, data: { status: to } });
    if (updated.count === 0) {
      return err({ code: "CONFLICT", message: "El pedido cambió mientras tanto; recarga el panel." });
    }
    const row = await this.db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, customer: true } });
    return ok(toPanelOrder(row));
  }
}
