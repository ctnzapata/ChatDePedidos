import { z } from "zod";
import type { ToolSpec as LlmToolSpec } from "../llm/types.ts";
import { MAX_QUANTITY_PER_LINE, addToCart, priceCart, renderPricedCart, updateLineQuantity } from "../domain/cart.ts";
import {
  FULFILLMENTS,
  FULFILLMENT_LABELS,
  PAYMENT_METHODS,
  buildQuote,
  type CheckoutDraft,
  type Fulfillment,
  type Quote,
  type StorePolicy,
} from "../domain/checkout.ts";
import type { MenuCatalog } from "../domain/menu.ts";
import { STATUS_LABELS, type OrderStatus } from "../domain/order-status.ts";
import { errorMessage, logger } from "../lib/logger.ts";
import { formatCop } from "../lib/money.ts";
import type { Result } from "../lib/result.ts";
import type { AgentState } from "./agent-state.ts";

export interface OrderSummary {
  readonly number: number;
  readonly status: OrderStatus;
  readonly total: number;
  readonly fulfillment: Fulfillment;
  readonly createdAt: Date;
  readonly itemsText: string;
}

/** Acceso a los pedidos del cliente actual (ya filtrado por restaurante y cliente). */
export interface CustomerOrdersPort {
  listRecent(): Promise<readonly OrderSummary[]>;
  cancel(orderNumber: number): Promise<Result<OrderSummary>>;
}

export interface ToolContext {
  readonly catalog: MenuCatalog;
  readonly policy: StorePolicy;
  readonly isOpen: boolean;
  readonly isAcceptingOrders: boolean;
  readonly openingHoursText: string;
  readonly orders: CustomerOrdersPort;
}

/** Acciones que el sistema ejecuta después del turno del agente (no las hace el modelo). */
export type AgentEffect =
  | { readonly type: "request_confirmation"; readonly quote: Quote }
  | { readonly type: "handoff"; readonly reason: string };

export interface ToolOutcome {
  readonly result: string;
  readonly isError: boolean;
  readonly state: AgentState;
  readonly effects: readonly AgentEffect[];
}

const success = (result: string, state: AgentState, effects: readonly AgentEffect[] = []): ToolOutcome => ({
  result,
  isError: false,
  state,
  effects,
});

const failure = (result: string, state: AgentState): ToolOutcome => ({ result, isError: true, state, effects: [] });

interface ToolSpec<S extends z.ZodObject> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  execute(input: z.infer<S>, state: AgentState, ctx: ToolContext): ToolOutcome | Promise<ToolOutcome>;
}

interface AgentTool {
  readonly definition: LlmToolSpec;
  run(rawInput: unknown, state: AgentState, ctx: ToolContext): Promise<ToolOutcome>;
}

function defineTool<S extends z.ZodObject>(spec: ToolSpec<S>): AgentTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(spec.input, { io: "input" });
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: schema,
    },
    async run(rawInput, state, ctx) {
      const parsed = spec.input.safeParse(rawInput);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        return failure(`Entrada inválida (${issues}). Corrige los datos y vuelve a intentar.`, state);
      }
      return spec.execute(parsed.data, state, ctx);
    },
  };
}

function storeUnavailableReason(ctx: ToolContext): string | null {
  if (!ctx.isAcceptingOrders) {
    return "El restaurante pausó los pedidos por ahora. Discúlpate e invita al cliente a escribir más tarde.";
  }
  if (!ctx.isOpen) {
    return `El local está cerrado y no puede tomar pedidos. Horario: ${ctx.openingHoursText}.`;
  }
  return null;
}

function cartText(state: AgentState, ctx: ToolContext): string {
  return renderPricedCart(priceCart(state.cart, ctx.catalog));
}

const addToCartTool = defineTool({
  name: "add_to_cart",
  description:
    "Agrega un producto del menú al carrito del cliente. Úsalo cada vez que el cliente pida algo. " +
    "Usa siempre el código exacto del menú (p. ej. HAM-SEN) y los códigos de adiciones (EXT-...). " +
    "Detalles como sabor de gaseosa, fruta del jugo o 'sin cebolla' van en notes. Devuelve el carrito con precios.",
  input: z.object({
    item_code: z.string().min(1).max(20).describe("Código del producto en el menú, p. ej. HAM-SEN"),
    quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE).describe("Cantidad de unidades"),
    extra_codes: z.array(z.string().max(20)).max(10).optional().describe("Códigos de adiciones, p. ej. [\"EXT-QUE\"]"),
    notes: z.string().max(200).optional().describe("Preferencias del cliente para este producto"),
  }),
  execute(input, state, ctx) {
    const unavailable = storeUnavailableReason(ctx);
    if (unavailable) return failure(unavailable, state);
    const result = addToCart(state.cart, ctx.catalog, {
      itemCode: input.item_code,
      quantity: input.quantity,
      modifierCodes: input.extra_codes ?? [],
      ...(input.notes ? { notes: input.notes } : {}),
    });
    if (!result.ok) return failure(result.error, state);
    const next: AgentState = { ...state, cart: result.value, pendingConfirmation: null };
    return success(`Producto agregado. Carrito actual:\n${cartText(next, ctx)}`, next);
  },
});

const updateCartItemTool = defineTool({
  name: "update_cart_item",
  description:
    "Cambia la cantidad de una línea del carrito usando su identificador (L1, L2...). Con quantity 0 la elimina. " +
    "Si no conoces el identificador, llama primero a view_cart.",
  input: z.object({
    line_id: z.string().min(1).max(10).describe("Identificador de la línea, p. ej. L2"),
    quantity: z.number().int().min(0).max(MAX_QUANTITY_PER_LINE).describe("Nueva cantidad; 0 elimina la línea"),
  }),
  execute(input, state, ctx) {
    const result = updateLineQuantity(state.cart, input.line_id, input.quantity);
    if (!result.ok) return failure(result.error, state);
    const next: AgentState = { ...state, cart: result.value, pendingConfirmation: null };
    return success(`Carrito actualizado:\n${cartText(next, ctx)}`, next);
  },
});

const viewCartTool = defineTool({
  name: "view_cart",
  description: "Muestra el carrito actual con identificadores de línea, precios y subtotal calculados por el sistema.",
  input: z.object({}),
  execute: (_input, state, ctx) => success(cartText(state, ctx), state),
});

function mergeCheckout(previous: CheckoutDraft, update: CheckoutDraft): CheckoutDraft {
  const merged: CheckoutDraft = { ...previous, ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) };
  const withoutAddress =
    merged.fulfillment === "PICKUP" ? (({ address: _a, addressNotes: _n, ...rest }) => rest)(merged) : merged;
  return withoutAddress.paymentMethod === "TRANSFER"
    ? (({ cashAmount: _c, ...rest }) => rest)(withoutAddress)
    : withoutAddress;
}

const setOrderDetailsTool = defineTool({
  name: "set_order_details",
  description:
    "Guarda los datos de entrega y pago a medida que el cliente los da (puedes enviar solo algunos campos). " +
    "Devuelve qué datos faltan todavía para poder confirmar el pedido.",
  input: z.object({
    fulfillment: z.enum(FULFILLMENTS).optional().describe("DELIVERY = domicilio, PICKUP = recoger en el local"),
    customer_name: z.string().min(1).max(80).optional().describe("Nombre de quien recibe o recoge"),
    address: z.string().min(5).max(200).optional().describe("Dirección completa con barrio (solo domicilio)"),
    address_notes: z.string().max(200).optional().describe("Apartamento, torre, conjunto o punto de referencia"),
    payment_method: z.enum(PAYMENT_METHODS).optional().describe("CASH = efectivo, TRANSFER = Nequi/Daviplata"),
    cash_amount: z.number().int().min(0).max(5_000_000).optional().describe("Con cuánto paga en efectivo, para llevar el cambio"),
    notes: z.string().max(300).optional().describe("Notas generales del pedido"),
  }),
  execute(input, state, ctx) {
    const checkout = mergeCheckout(state.checkout, {
      fulfillment: input.fulfillment,
      customerName: input.customer_name,
      address: input.address,
      addressNotes: input.address_notes,
      paymentMethod: input.payment_method,
      cashAmount: input.cash_amount,
      notes: input.notes,
    });
    const next: AgentState = { ...state, checkout, pendingConfirmation: null };
    const quote = buildQuote(next.cart, ctx.catalog, checkout, ctx.policy);
    const status = quote.ok
      ? `Todo listo. Total: ${formatCop(quote.value.total)}. Ya puedes llamar a request_order_confirmation.`
      : `Aún falta:\n- ${quote.error.join("\n- ")}`;
    return success(`Datos guardados. ${status}`, next);
  },
});

const requestConfirmationTool = defineTool({
  name: "request_order_confirmation",
  description:
    "Cuando el carrito y los datos de entrega y pago estén completos, valida el pedido, calcula el total definitivo " +
    "y le envía al cliente el resumen con los botones 'Confirmar pedido' y 'Modificar'. El pedido SOLO se crea cuando " +
    "el cliente toca 'Confirmar pedido'; nunca digas que ya está confirmado.",
  input: z.object({}),
  execute(_input, state, ctx) {
    const unavailable = storeUnavailableReason(ctx);
    if (unavailable) return failure(unavailable, state);
    const quote = buildQuote(state.cart, ctx.catalog, state.checkout, ctx.policy);
    if (!quote.ok) return failure(`Todavía no se puede confirmar:\n- ${quote.error.join("\n- ")}`, state);
    const next: AgentState = { ...state, pendingConfirmation: { total: quote.value.total } };
    return success(
      `El sistema le enviará al cliente el resumen (total ${formatCop(quote.value.total)}) con los botones de confirmación. ` +
        "Responde solo con una frase corta invitándolo a revisar el resumen y tocar 'Confirmar pedido'.",
      next,
      [{ type: "request_confirmation", quote: quote.value }],
    );
  },
});

function renderOrderSummary(order: OrderSummary): string {
  return `Pedido #${order.number} — ${STATUS_LABELS[order.status]} — ${FULFILLMENT_LABELS[order.fulfillment]} — ${formatCop(order.total)}: ${order.itemsText}`;
}

const getOrderStatusTool = defineTool({
  name: "get_order_status",
  description: "Consulta el estado de los pedidos recientes de este cliente.",
  input: z.object({}),
  async execute(_input, state, ctx) {
    const orders = await ctx.orders.listRecent();
    if (orders.length === 0) return success("El cliente no tiene pedidos recientes.", state);
    return success(orders.map(renderOrderSummary).join("\n"), state);
  },
});

const cancelOrderTool = defineTool({
  name: "cancel_order",
  description:
    "Cancela un pedido del cliente. Solo funciona si el restaurante todavía no lo ha aceptado. " +
    "Confirma con el cliente el número de pedido antes de usarla.",
  input: z.object({ order_number: z.number().int().positive().describe("Número del pedido, p. ej. 12") }),
  async execute(input, state, ctx) {
    const result = await ctx.orders.cancel(input.order_number);
    if (!result.ok) return failure(result.error, state);
    return success(`Pedido #${result.value.number} cancelado.`, state);
  },
});

const transferToHumanTool = defineTool({
  name: "transfer_to_human",
  description:
    "Pasa la conversación a una persona del restaurante: quejas, reclamos, reembolsos, pedidos para eventos, " +
    "algo que no puedes resolver o cuando el cliente pide hablar con alguien. El asistente queda en pausa con este cliente.",
  input: z.object({ reason: z.string().min(3).max(300).describe("Motivo breve para el equipo") }),
  execute: (input, state) =>
    success(
      "Se avisó al equipo del restaurante y el asistente queda en pausa con este cliente. " +
        "Despídete diciendo que una persona del equipo le escribirá pronto.",
      state,
      [{ type: "handoff", reason: input.reason }],
    ),
});

const TOOLS: readonly AgentTool[] = [
  addToCartTool,
  updateCartItemTool,
  viewCartTool,
  setOrderDetailsTool,
  requestConfirmationTool,
  getOrderStatusTool,
  cancelOrderTool,
  transferToHumanTool,
];

/** Orden fijo: cambiarlo invalida la caché del prompt. */
export const TOOL_DEFINITIONS: readonly LlmToolSpec[] = TOOLS.map((tool) => tool.definition);

export async function executeTool(
  name: string,
  rawInput: unknown,
  state: AgentState,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const tool = TOOLS.find((t) => t.definition.name === name);
  if (!tool) return failure(`La herramienta ${name} no existe.`, state);
  try {
    return await tool.run(rawInput, state, ctx);
  } catch (error: unknown) {
    logger.error({ tool: name, err: errorMessage(error) }, "Fallo ejecutando herramienta del agente");
    return failure("Error interno del sistema. Discúlpate y ofrece pasar la conversación a una persona.", state);
  }
}
