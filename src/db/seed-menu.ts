import { readFileSync } from "node:fs";
import { z } from "zod";
import { PAYMENT_METHODS } from "../domain/checkout.ts";
import { openingHoursSchema } from "../domain/hours.ts";
import { toJson, type Db } from "./client.ts";

const CODE = /^[A-Z]{3}-[A-Z]{3}$/;
// Reemplazar un menú grande en SQLite puede pasar del timeout por defecto de Prisma (5 s).
const SEED_TRANSACTION_TIMEOUT_MS = 60_000;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
const price = z.number().int().min(0);

export const seedFileSchema = z.object({
  restaurant: z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    whatsappPhoneNumberId: z.string().min(1),
    staffPhone: z.string().regex(/^\d{8,15}$/).nullable(),
    address: z.string().min(1),
    timezone: z.string().refine(isValidTimeZone, "zona horaria IANA inválida (p. ej. America/Bogota)"),
    openingHours: openingHoursSchema.min(1),
    deliveryFee: price,
    minOrderAmount: price,
    prepTimeMinutes: z.number().int().positive(),
    deliveryTimeMinutes: z.number().int().positive(),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
    transferInfo: z.string().nullable(),
  }),
  extras: z.array(
    z.object({ code: z.string().regex(CODE), name: z.string().min(1), price, isAvailable: z.boolean().optional() }),
  ),
  categories: z.array(
    z.object({
      name: z.string().min(1),
      items: z.array(
        z.object({
          code: z.string().regex(CODE),
          name: z.string().min(1),
          description: z.string(),
          price,
          isAvailable: z.boolean().optional(),
          extras: z.array(z.string().regex(CODE)),
        }),
      ),
    }),
  ),
});

export type SeedFile = z.infer<typeof seedFileSchema>;

export interface SeedOverrides {
  readonly whatsappPhoneNumberId?: string;
  readonly staffPhone?: string | null;
}

export function readSeedFile(path: string): SeedFile {
  const parsed = seedFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`El archivo ${path} no es válido:\n${details}`);
  }
  return parsed.data;
}

/**
 * Crea o actualiza el restaurante (por slug) y reemplaza su menú.
 * Los pedidos guardan copia de nombres y precios, así que reemplazar el menú no los afecta.
 */
export async function seedRestaurant(db: Db, data: SeedFile, overrides: SeedOverrides = {}): Promise<string> {
  const { openingHours, paymentMethods, ...restaurantFields } = data.restaurant;
  const fields = {
    ...restaurantFields,
    whatsappPhoneNumberId: overrides.whatsappPhoneNumberId ?? restaurantFields.whatsappPhoneNumberId,
    staffPhone: overrides.staffPhone !== undefined ? overrides.staffPhone : restaurantFields.staffPhone,
    openingHours: toJson(openingHours),
    paymentMethods,
  };

  return db.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.upsert({ where: { slug: fields.slug }, create: fields, update: fields });
    await tx.menuModifier.deleteMany({ where: { restaurantId: restaurant.id } });
    await tx.menuCategory.deleteMany({ where: { restaurantId: restaurant.id } });

    const modifierIds = new Map<string, string>();
    for (const extra of data.extras) {
      const created = await tx.menuModifier.create({
        data: { restaurantId: restaurant.id, code: extra.code, name: extra.name, price: extra.price, isAvailable: extra.isAvailable ?? true },
      });
      modifierIds.set(extra.code, created.id);
    }

    for (const [categoryIndex, category] of data.categories.entries()) {
      const createdCategory = await tx.menuCategory.create({
        data: { restaurantId: restaurant.id, name: category.name, sortOrder: categoryIndex },
      });
      for (const [itemIndex, item] of category.items.entries()) {
        const missing = item.extras.filter((code) => !modifierIds.has(code));
        if (missing.length > 0) throw new Error(`${item.code} usa adiciones inexistentes: ${missing.join(", ")}`);
        await tx.menuItem.create({
          data: {
            restaurantId: restaurant.id,
            categoryId: createdCategory.id,
            code: item.code,
            name: item.name,
            description: item.description,
            price: item.price,
            isAvailable: item.isAvailable ?? true,
            sortOrder: itemIndex,
            modifiers: { connect: item.extras.map((code) => ({ id: modifierIds.get(code)! })) },
          },
        });
      }
    }
    return restaurant.id;
  }, { timeout: SEED_TRANSACTION_TIMEOUT_MS });
}
