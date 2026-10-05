import { PrismaClient } from "@prisma/client";
import { readSeedFile, seedRestaurant } from "../../src/db/seed-menu.ts";

// Usa DATABASE_URL de vitest.config.ts (prisma/test.db).
export const testPrisma = new PrismaClient();

export const TEST_PHONE_NUMBER_ID = "PNID-TEST";
export const STAFF_PHONE = "573009998877";
export const CUSTOMER_PHONE = "573001112233";

/** Lunes 5 de octubre de 2026, 3:00 p. m. en Bogotá: el local está abierto. */
export const MONDAY_3PM = new Date("2026-10-05T15:00:00-05:00");

export async function resetDatabase(): Promise<void> {
  // Borrar los restaurantes elimina en cascada menú, clientes, conversaciones y pedidos.
  await testPrisma.restaurant.deleteMany();
}

export async function seedTestStore(): Promise<string> {
  return seedRestaurant(testPrisma, readSeedFile("seed/menu.json"), {
    whatsappPhoneNumberId: TEST_PHONE_NUMBER_ID,
    staffPhone: STAFF_PHONE,
  });
}
