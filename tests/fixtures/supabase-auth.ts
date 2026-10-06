import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import { TEST_SUPABASE_URL, assertLocalDatabase, type TestSupabaseKeys } from "../test-database.ts";

/** Mismo dominio que fixtures/rls.ts: deleteTestAuthUsers() limpia estos usuarios. */
export const TEST_EMAIL_DOMAIN = "rls.test";

export interface TestSession {
  readonly userId: string;
  readonly email: string;
  readonly accessToken: string;
}

const noPersistence = { auth: { persistSession: false, autoRefreshToken: false } };

assertLocalDatabase(TEST_SUPABASE_URL);

/** Llaves del Supabase local que entrega tests/global-setup.ts (leídas con `supabase status`). */
export function testSupabaseKeys(): TestSupabaseKeys {
  return inject("supabaseKeys");
}

function adminClient(): SupabaseClient {
  return createClient(TEST_SUPABASE_URL, testSupabaseKeys().secretKey, noPersistence);
}

/** Crea un usuario en el Supabase Auth local e inicia sesión: devuelve un access token real. */
export async function createUserWithSession(label: string): Promise<TestSession> {
  const email = `${label}-${randomBytes(4).toString("hex")}@${TEST_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`No se pudo crear ${email}: ${created.error?.message}`);

  const client = createClient(TEST_SUPABASE_URL, testSupabaseKeys().publishableKey, noPersistence);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`No se pudo iniciar sesión: ${signedIn.error?.message}`);

  return { userId: created.data.user.id, email, accessToken: signedIn.data.session.access_token };
}
