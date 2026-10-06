import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { testPrisma } from "./db.ts";

/** Dominio de los usuarios de prueba; se borran todos al empezar cada prueba. */
const TEST_EMAIL_DOMAIN = "rls.test";

/** Tablas que se pueden consultar con `visibleIds` (lista cerrada: nada de SQL dinámico arbitrario). */
const QUERYABLE_TABLES = [
  "restaurants",
  "staff_members",
  "menu_categories",
  "menu_items",
  "menu_modifiers",
  "customers",
  "conversations",
  "messages",
  "orders",
  "order_items",
] as const;
export type QueryableTable = (typeof QUERYABLE_TABLES)[number];

type Tx = Prisma.TransactionClient;

/** Crea un usuario mínimo en auth.users, como lo haría Supabase Auth al aceptar una invitación. */
export async function createAuthUser(label: string): Promise<string> {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
  await testPrisma.$executeRaw`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (${id}::uuid, 'authenticated', 'authenticated', ${email}, now(), now())`;
  return id;
}

export async function deleteTestAuthUsers(): Promise<void> {
  await testPrisma.$executeRaw`delete from auth.users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`;
}

/**
 * Ejecuta `fn` como lo vería un cliente de Supabase desde el navegador:
 * rol `anon` (sin sesión) o `authenticated` con el JWT del usuario. Así se prueban las políticas RLS reales.
 */
export async function asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    if (userId) {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });
      await tx.$queryRaw`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx.$executeRawUnsafe("set local role authenticated");
    } else {
      await tx.$executeRawUnsafe("set local role anon");
    }
    return fn(tx);
  });
}

/** Ids de las filas de `table` que el usuario puede ver, ordenados. */
export async function visibleIds(userId: string | null, table: QueryableTable): Promise<string[]> {
  if (!QUERYABLE_TABLES.includes(table)) throw new Error(`Tabla no permitida: ${table}`);
  const rows = await asUser(userId, (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`select id::text as id from "${table}"`));
  return rows.map((row) => row.id).sort();
}
