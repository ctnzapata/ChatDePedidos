import type { FastifyReply } from "fastify";
import type { z } from "zod";
import type { TransitionError } from "../repositories/order-repository.ts";

/** Código HTTP para cada error al cambiar el estado de un pedido. */
export const TRANSITION_HTTP_STATUS: Record<TransitionError["code"], number> = {
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  COURIER_REQUIRED: 422,
  INVALID_COURIER: 422,
};

/** Formato único de respuesta de la API: { success, data, error }. */
export function sendOk(reply: FastifyReply, data: unknown): FastifyReply {
  return reply.send({ success: true, data, error: null });
}

export function sendError(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ success: false, data: null, error });
}

/** Valida con Zod; si falla responde 400 con el detalle y devuelve null. */
export function parseOr400<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  sendError(reply, 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return null;
}
