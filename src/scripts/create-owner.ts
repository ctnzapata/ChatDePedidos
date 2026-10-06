import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadDotEnv } from "../config/env.ts";
import { createDb } from "../db/client.ts";
import { StaffRepository } from "../repositories/staff-repository.ts";

// Crea el primer dueño de un restaurante (solo un dueño puede invitar a los demás).
// Uso: npm run admin:create-owner -- --email ana@ejemplo.com --nombre "Ana" [--restaurante la-esquina-rapida]
// Si la persona no tiene cuenta, se crea con una contraseña temporal que se muestra una sola vez.

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run(): Promise<void> {
  loadDotEnv();
  const parsedEnv = envSchema.safeParse(process.env);
  if (!parsedEnv.success) throw new Error("Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o DATABASE_URL en .env");
  const env = parsedEnv.data;
  const parsedEmail = z.email().safeParse(argValue("--email")?.trim().toLowerCase());
  if (!parsedEmail.success) {
    throw new Error('Correo inválido. Uso: npm run admin:create-owner -- --email ana@ejemplo.com --nombre "Ana"');
  }
  const email = parsedEmail.data;
  const displayName = argValue("--nombre")?.trim() || email.split("@")[0]!;
  const slug = argValue("--restaurante");

  const db = createDb();
  try {
    const restaurant = slug
      ? await db.restaurant.findUnique({ where: { slug } })
      : await db.restaurant.findFirst({ orderBy: { createdAt: "asc" } });
    if (!restaurant) throw new Error(slug ? `No existe el restaurante "${slug}".` : "No hay restaurantes. Ejecuta: npm run db:setup");

    const existing = await db.$queryRaw<{ id: string }[]>`
      select id::text as id from auth.users where lower(email) = ${email} limit 1`;
    let userId = existing[0]?.id;
    let temporaryPassword: string | undefined;
    if (!userId) {
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      temporaryPassword = randomBytes(12).toString("base64url");
      const created = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`No se pudo crear el usuario: ${created.error?.message}`);
      userId = created.data.user.id;
    }

    await new StaffRepository(db).addOrReactivate({ userId, restaurantId: restaurant.id, role: "OWNER", displayName });
    process.stdout.write(`✔ ${email} es dueño de ${restaurant.name}.\n`);
    if (temporaryPassword) {
      process.stdout.write(
        `  Contraseña temporal (se muestra una sola vez, cámbiala al entrar): ${temporaryPassword}\n`,
      );
    } else {
      process.stdout.write("  La cuenta ya existía: entra con tu contraseña actual.\n");
    }
  } finally {
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
