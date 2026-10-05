import { z } from "zod";
import { EMPTY_CART, MAX_QUANTITY_PER_LINE, type Cart } from "../domain/cart.ts";
import { FULFILLMENTS, PAYMENT_METHODS, type CheckoutDraft } from "../domain/checkout.ts";

export interface PendingConfirmation {
  /** Total cotizado cuando se enviaron los botones; si cambia, se vuelve a pedir confirmación. */
  readonly total: number;
}

/** Estado de la conversación que las herramientas leen y devuelven actualizado (nunca lo mutan). */
export interface AgentState {
  readonly cart: Cart;
  readonly checkout: CheckoutDraft;
  readonly pendingConfirmation: PendingConfirmation | null;
}

export const INITIAL_AGENT_STATE: AgentState = { cart: EMPTY_CART, checkout: {}, pendingConfirmation: null };

const stateSchema = z.object({
  cart: z.object({
    lines: z.array(
      z.object({
        lineId: z.string(),
        itemCode: z.string(),
        quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE),
        modifierCodes: z.array(z.string()),
        notes: z.string().optional(),
      }),
    ),
    nextLineNumber: z.number().int().min(1),
  }),
  checkout: z.object({
    fulfillment: z.enum(FULFILLMENTS).optional(),
    customerName: z.string().optional(),
    address: z.string().optional(),
    addressNotes: z.string().optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    cashAmount: z.number().int().optional(),
    notes: z.string().optional(),
  }),
  pendingConfirmation: z.object({ total: z.number().int() }).nullable(),
});

/** Lee el estado guardado; si está vacío o dañado, empieza de cero en lugar de romper la conversación. */
export function parseAgentState(raw: string): AgentState {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : INITIAL_AGENT_STATE;
  } catch {
    return INITIAL_AGENT_STATE;
  }
}

export function serializeAgentState(state: AgentState): string {
  return JSON.stringify(state);
}
