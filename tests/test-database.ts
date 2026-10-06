// Base de datos de pruebas: Supabase local (npm run supabase:start).
// Credenciales públicas de desarrollo de la CLI de Supabase; no son secretas.
const LOCAL_SUPABASE_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_SUPABASE_DB;

// API del Supabase local. Las llaves NO van en el código: global-setup las lee con `supabase status`.
export const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";

export interface TestSupabaseKeys {
  readonly publishableKey: string;
  readonly secretKey: string;
}

/**
 * Las pruebas BORRAN datos. Se niegan a correr contra una base que no sea local
 * para no tocar nunca el proyecto de Supabase en la nube.
 */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Las pruebas solo pueden usar una base local y se configuró "${host}". Revisa TEST_DATABASE_URL.`);
  }
}
