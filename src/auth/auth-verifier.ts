import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  readonly userId: string;
  readonly email: string | null;
}

export interface AuthVerifier {
  /** Devuelve el usuario si el token es válido y vigente; null en cualquier otro caso. */
  verify(accessToken: string): Promise<AuthenticatedUser | null>;
}

/**
 * Verifica tokens de Supabase Auth con getClaims(): usa las llaves públicas del proyecto (JWKS)
 * cuando el proyecto firma con llaves asimétricas, o consulta al servidor de Auth si no.
 */
export class SupabaseAuthVerifier implements AuthVerifier {
  constructor(private readonly client: SupabaseClient) {}

  static create(supabaseUrl: string, publishableKey: string): SupabaseAuthVerifier {
    return new SupabaseAuthVerifier(
      createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
  }

  async verify(accessToken: string): Promise<AuthenticatedUser | null> {
    const { data, error } = await this.client.auth.getClaims(accessToken);
    if (error || !data) return null;
    const { sub, role, email } = data.claims;
    if (typeof sub !== "string" || role !== "authenticated") return null;
    return { userId: sub, email: typeof email === "string" ? email : null };
  }
}
