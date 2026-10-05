import { PrismaClient } from "@prisma/client";

export type Db = PrismaClient;

export function createDb(): Db {
  return new PrismaClient();
}

/** Código de Prisma para violación de restricción única. */
export const UNIQUE_VIOLATION = "P2002";

// Conflicto de escritura / timeout de transacción: en SQLite aparecen cuando dos escrituras compiten.
const RETRYABLE_WRITE_ERRORS = new Set([UNIQUE_VIOLATION, "P2034", "P1008"]);

function prismaCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === UNIQUE_VIOLATION;
}

export function isRetryableWriteError(error: unknown): boolean {
  const code = prismaCode(error);
  return typeof code === "string" && RETRYABLE_WRITE_ERRORS.has(code);
}
