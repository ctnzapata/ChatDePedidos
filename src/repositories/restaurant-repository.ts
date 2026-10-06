import type { Restaurant } from "@prisma/client";
import { z } from "zod";
import { PAYMENT_METHODS } from "../domain/checkout.ts";
import { openingHoursSchema } from "../domain/hours.ts";
import type { MenuCatalog } from "../domain/menu.ts";
import type { StoreProfile } from "../domain/store.ts";
import type { Db } from "../db/client.ts";

const paymentMethodsSchema = z.array(z.enum(PAYMENT_METHODS)).min(1);

function parseJsonField<T>(schema: z.ZodType<T>, raw: unknown, field: string, slug: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Restaurante ${slug}: el campo ${field} no es válido`);
  return parsed.data;
}

function toProfile(row: Restaurant): StoreProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    whatsappPhoneNumberId: row.whatsappPhoneNumberId,
    staffPhone: row.staffPhone,
    address: row.address,
    timezone: row.timezone,
    openingHours: parseJsonField(openingHoursSchema, row.openingHours, "openingHours", row.slug),
    policy: {
      deliveryFee: row.deliveryFee,
      minOrderAmount: row.minOrderAmount,
      paymentMethods: parseJsonField(paymentMethodsSchema, row.paymentMethods, "paymentMethods", row.slug),
    },
    prepTimeMinutes: row.prepTimeMinutes,
    deliveryTimeMinutes: row.deliveryTimeMinutes,
    transferInfo: row.transferInfo,
    isAcceptingOrders: row.isAcceptingOrders,
  };
}

export class RestaurantRepository {
  constructor(private readonly db: Db) {}

  async findByPhoneNumberId(phoneNumberId: string): Promise<StoreProfile | null> {
    const row = await this.db.restaurant.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
    return row ? toProfile(row) : null;
  }

  async findById(id: string): Promise<StoreProfile | null> {
    const row = await this.db.restaurant.findUnique({ where: { id } });
    return row ? toProfile(row) : null;
  }

  async listAll(): Promise<StoreProfile[]> {
    const rows = await this.db.restaurant.findMany({ orderBy: { name: "asc" } });
    return rows.map(toProfile);
  }

  async loadCatalog(restaurantId: string): Promise<MenuCatalog> {
    const categories = await this.db.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" }, include: { modifiers: { orderBy: { price: "asc" } } } } },
    });
    return {
      items: categories.flatMap((category) =>
        category.items.map((item) => ({
          code: item.code,
          name: item.name,
          description: item.description,
          category: category.name,
          price: item.price,
          isAvailable: item.isAvailable,
          modifiers: item.modifiers.map((m) => ({ code: m.code, name: m.name, price: m.price, isAvailable: m.isAvailable })),
        })),
      ),
    };
  }

  async setAcceptingOrders(restaurantId: string, isAcceptingOrders: boolean): Promise<void> {
    await this.db.restaurant.update({ where: { id: restaurantId }, data: { isAcceptingOrders } });
  }

  /** Cambia la disponibilidad de un producto o adición por código. Devuelve false si no existe. */
  async setAvailability(restaurantId: string, code: string, isAvailable: boolean): Promise<boolean> {
    const items = await this.db.menuItem.updateMany({ where: { restaurantId, code }, data: { isAvailable } });
    if (items.count > 0) return true;
    const modifiers = await this.db.menuModifier.updateMany({ where: { restaurantId, code }, data: { isAvailable } });
    return modifiers.count > 0;
  }
}
