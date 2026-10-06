import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { TEST_DATABASE_URL, assertLocalDatabase, type TestSupabaseKeys } from "./test-database.ts";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseKeys: TestSupabaseKeys;
  }
}

const SETUP_HINT =
  "No se pudo preparar la base de pruebas. ¿Está corriendo Supabase local?\n" +
  "  1. Abre Docker Desktop\n" +
  "  2. Ejecuta: npm run supabase:start";

function stderrOf(error: unknown): string {
  return (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
}

/** Llaves del Supabase local: de variables de entorno o de `supabase status` (nunca escritas en el código). */
function readLocalKeys(): TestSupabaseKeys {
  const fromEnv = { publishableKey: process.env.TEST_SUPABASE_PUBLISHABLE_KEY, secretKey: process.env.TEST_SUPABASE_SECRET_KEY };
  if (fromEnv.publishableKey && fromEnv.secretKey) {
    return { publishableKey: fromEnv.publishableKey, secretKey: fromEnv.secretKey };
  }
  const status = JSON.parse(execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "pipe"] }).toString()) as {
    PUBLISHABLE_KEY?: string;
    SECRET_KEY?: string;
  };
  if (!status.PUBLISHABLE_KEY || !status.SECRET_KEY) throw new Error("`supabase status` no devolvió las llaves locales");
  return { publishableKey: status.PUBLISHABLE_KEY, secretKey: status.SECRET_KEY };
}

// Aplica las migraciones a la base de pruebas (Supabase local) y comparte las llaves locales con los tests.
export default function setup(project: TestProject): void {
  assertLocalDatabase(TEST_DATABASE_URL);
  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
    project.provide("supabaseKeys", readLocalKeys());
  } catch (error: unknown) {
    throw new Error(`${SETUP_HINT}\n\n${stderrOf(error)}`);
  }
}
