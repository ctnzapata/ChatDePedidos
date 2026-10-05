import { formatCop } from "../lib/money.ts";

export interface ModifierInfo {
  readonly code: string;
  readonly name: string;
  readonly price: number;
  readonly isAvailable: boolean;
}

export interface MenuItemInfo {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly price: number;
  readonly isAvailable: boolean;
  readonly modifiers: readonly ModifierInfo[];
}

/** Menú de un restaurante, ya ordenado por categoría. */
export interface MenuCatalog {
  readonly items: readonly MenuItemInfo[];
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function findItem(catalog: MenuCatalog, code: string): MenuItemInfo | undefined {
  const wanted = normalizeCode(code);
  return catalog.items.find((item) => item.code === wanted);
}

const SOLD_OUT = " (AGOTADO)";

function renderItem(item: MenuItemInfo): string {
  const header = `- [${item.code}] ${item.name} — ${formatCop(item.price)}${item.isAvailable ? "" : SOLD_OUT}`;
  const lines = [header, `  ${item.description}`];
  if (item.modifiers.length > 0) {
    const extras = item.modifiers
      .map((m) => `[${m.code}] ${m.name} +${formatCop(m.price)}${m.isAvailable ? "" : SOLD_OUT}`)
      .join("; ");
    lines.push(`  Adiciones: ${extras}`);
  }
  return lines.join("\n");
}

/** Menú en texto plano para el prompt del agente. */
export function renderMenuText(catalog: MenuCatalog): string {
  const sections: string[] = [];
  let currentCategory: string | undefined;
  for (const item of catalog.items) {
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      sections.push(`## ${item.category}`);
    }
    sections.push(renderItem(item));
  }
  return sections.join("\n");
}
