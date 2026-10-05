import { formatCop } from "../lib/money.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { findItem, normalizeCode, type MenuCatalog, type ModifierInfo } from "./menu.ts";

export const MAX_QUANTITY_PER_LINE = 20;
export const MAX_CART_LINES = 30;

export interface CartLine {
  readonly lineId: string;
  readonly itemCode: string;
  readonly quantity: number;
  readonly modifierCodes: readonly string[];
  readonly notes?: string;
}

export interface Cart {
  readonly lines: readonly CartLine[];
  readonly nextLineNumber: number;
}

export const EMPTY_CART: Cart = { lines: [], nextLineNumber: 1 };

export interface AddToCartInput {
  readonly itemCode: string;
  readonly quantity: number;
  readonly modifierCodes: readonly string[];
  readonly notes?: string;
}

export interface PricedLine {
  readonly lineId: string;
  readonly itemCode: string;
  readonly name: string;
  readonly quantity: number;
  readonly modifiers: readonly Pick<ModifierInfo, "code" | "name" | "price">[];
  readonly notes?: string;
  readonly unitPrice: number;
  readonly lineTotal: number;
}

export interface PricedCart {
  readonly lines: readonly PricedLine[];
  readonly subtotal: number;
  /** Líneas que ya no se pueden vender (agotadas o retiradas del menú). */
  readonly problems: readonly string[];
}

function isValidQuantity(quantity: number, min: number): boolean {
  return Number.isInteger(quantity) && quantity >= min && quantity <= MAX_QUANTITY_PER_LINE;
}

export function addToCart(cart: Cart, catalog: MenuCatalog, input: AddToCartInput): Result<Cart> {
  const item = findItem(catalog, input.itemCode);
  if (!item) return err(`El producto ${input.itemCode} no existe en el menú.`);
  if (!item.isAvailable) return err(`${item.name} está agotado por ahora.`);
  if (!isValidQuantity(input.quantity, 1)) {
    return err(`La cantidad debe ser un número entero entre 1 y ${MAX_QUANTITY_PER_LINE}.`);
  }
  if (cart.lines.length >= MAX_CART_LINES) return err("El carrito tiene demasiados productos.");

  const modifierCodes = input.modifierCodes.map(normalizeCode);
  if (new Set(modifierCodes).size !== modifierCodes.length) return err("Hay adiciones repetidas.");
  for (const code of modifierCodes) {
    const modifier = item.modifiers.find((m) => m.code === code);
    if (!modifier) return err(`La adición ${code} no aplica para ${item.name}.`);
    if (!modifier.isAvailable) return err(`La adición ${modifier.name} está agotada por ahora.`);
  }

  const notes = input.notes?.trim();
  const line: CartLine = {
    lineId: `L${cart.nextLineNumber}`,
    itemCode: item.code,
    quantity: input.quantity,
    modifierCodes,
    ...(notes ? { notes } : {}),
  };
  return ok({ lines: [...cart.lines, line], nextLineNumber: cart.nextLineNumber + 1 });
}

/** Cambia la cantidad de una línea; 0 la elimina. */
export function updateLineQuantity(cart: Cart, lineId: string, quantity: number): Result<Cart> {
  const wanted = normalizeCode(lineId);
  if (!cart.lines.some((line) => line.lineId === wanted)) return err(`No existe la línea ${lineId} en el carrito.`);
  if (!isValidQuantity(quantity, 0)) {
    return err(`La cantidad debe ser un número entero entre 0 y ${MAX_QUANTITY_PER_LINE}.`);
  }
  const lines =
    quantity === 0
      ? cart.lines.filter((line) => line.lineId !== wanted)
      : cart.lines.map((line) => (line.lineId === wanted ? { ...line, quantity } : line));
  return ok({ ...cart, lines });
}

/** Calcula precios siempre desde el menú vigente, nunca desde lo que diga el modelo. */
export function priceCart(cart: Cart, catalog: MenuCatalog): PricedCart {
  const lines: PricedLine[] = [];
  const problems: string[] = [];

  for (const line of cart.lines) {
    const item = findItem(catalog, line.itemCode);
    if (!item || !item.isAvailable) {
      problems.push(`${line.lineId}: ${item?.name ?? line.itemCode} ya no está disponible.`);
      continue;
    }
    const modifiers = line.modifierCodes.map((code) => item.modifiers.find((m) => m.code === code));
    const validModifiers = modifiers.filter((m): m is ModifierInfo => m !== undefined && m.isAvailable);
    if (validModifiers.length !== modifiers.length) {
      problems.push(`${line.lineId}: una adición de ${item.name} ya no está disponible.`);
      continue;
    }
    const unitPrice = item.price + validModifiers.reduce((sum, m) => sum + m.price, 0);
    lines.push({
      lineId: line.lineId,
      itemCode: item.code,
      name: item.name,
      quantity: line.quantity,
      modifiers: validModifiers.map(({ code, name, price }) => ({ code, name, price })),
      ...(line.notes ? { notes: line.notes } : {}),
      unitPrice,
      lineTotal: unitPrice * line.quantity,
    });
  }

  return { lines, subtotal: lines.reduce((sum, l) => sum + l.lineTotal, 0), problems };
}

export function renderPricedLine(line: PricedLine): string {
  const extras = line.modifiers.length > 0 ? ` + ${line.modifiers.map((m) => m.name).join(", ")}` : "";
  const notes = line.notes ? ` (${line.notes})` : "";
  return `${line.quantity} x ${line.name}${extras}${notes} — ${formatCop(line.lineTotal)}`;
}

export function renderPricedCart(priced: PricedCart): string {
  if (priced.lines.length === 0 && priced.problems.length === 0) return "El carrito está vacío.";
  const rows = priced.lines.map((line) => `${line.lineId}: ${renderPricedLine(line)}`);
  const problems = priced.problems.map((p) => `⚠️ ${p}`);
  return [...rows, ...problems, `Subtotal: ${formatCop(priced.subtotal)}`].join("\n");
}
