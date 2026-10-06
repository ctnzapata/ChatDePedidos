import { execSync } from "node:child_process";
import { TEST_DATABASE_URL, assertLocalDatabase } from "./test-database.ts";

const SETUP_HINT =
  "No se pudo preparar la base de pruebas. ¿Está corriendo Supabase local?\n" +
  "  1. Abre Docker Desktop\n" +
  "  2. Ejecuta: npm run supabase:start";

// Aplica las migraciones a la base de pruebas (Supabase local). Cada prueba limpia sus datos.
export default function setup(): void {
  assertLocalDatabase(TEST_DATABASE_URL);
  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  } catch (error: unknown) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(`${SETUP_HINT}\n\n${output}`);
  }
}
