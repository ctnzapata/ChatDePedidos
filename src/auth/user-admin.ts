import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "../db/client.ts";
import { err, ok, type Result } from "../lib/result.ts";

/** Operaciones de administración de usuarios de Supabase Auth (solo servidor, con la llave secreta). */
export interface UserAdmin {
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Envía la invitación por correo y devuelve el id del usuario creado. */
  inviteByEmail(email: string, redirectTo: string, displayName: string): Promise<Result<string>>;
}

export class SupabaseUserAdmin implements UserAdmin {
  constructor(
    private readonly client: SupabaseClient,
    private readonly db: Db,
  ) {}

  static create(supabaseUrl: string, secretKey: string, db: Db): SupabaseUserAdmin {
    const client = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return new SupabaseUserAdmin(client, db);
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      select id::text as id from auth.users where lower(email) = lower(${email}) limit 1`;
    return rows[0]?.id ?? null;
  }

  async inviteByEmail(email: string, redirectTo: string, displayName: string): Promise<Result<string>> {
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { display_name: displayName },
    });
    if (error || !data.user) return err(`No se pudo enviar la invitación: ${error?.message ?? "error desconocido"}`);
    return ok(data.user.id);
  }
}
