import { loadDotEnv, parseBaseConfig } from "../config/env.ts";
import { createDb } from "../db/client.ts";
import { readSeedFile, seedRestaurant } from "../db/seed-menu.ts";

// Uso: npm run db:seed [ruta-al-menu.json]
// SEED_WHATSAPP_PHONE_NUMBER_ID y SEED_STAFF_PHONE (opcionales) reemplazan los valores del JSON.
async function run(): Promise<void> {
  loadDotEnv();
  parseBaseConfig(process.env);
  const path = process.argv[2] ?? "seed/menu.json";
  const data = readSeedFile(path);
  const db = createDb();
  try {
    const restaurantId = await seedRestaurant(db, data, {
      ...(process.env.SEED_WHATSAPP_PHONE_NUMBER_ID ? { whatsappPhoneNumberId: process.env.SEED_WHATSAPP_PHONE_NUMBER_ID } : {}),
      ...(process.env.SEED_STAFF_PHONE ? { staffPhone: process.env.SEED_STAFF_PHONE } : {}),
    });
    const items = data.categories.reduce((sum, c) => sum + c.items.length, 0);
    process.stdout.write(`✔ ${data.restaurant.name} listo (${restaurantId}): ${data.categories.length} categorías, ${items} productos.\n`);
  } finally {
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
