import { z } from "zod";
import type { ChatMessage } from "../llm/types.ts";

const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
    isError: z.boolean(),
  }),
]);

const historySchema = z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    parts: z.array(partSchema),
    raw: z.object({ provider: z.string(), payload: z.unknown() }).optional(),
  }),
);

/** Un turno válido empieza con un mensaje del cliente que no sea un resultado de herramienta. */
function isTurnStart(message: ChatMessage): boolean {
  return message.role === "user" && !message.parts.some((part) => part.type === "tool_result");
}

/**
 * Conserva los últimos `limit` mensajes, cortando siempre al inicio de un turno para no dejar
 * un resultado de herramienta sin su llamada. Si un solo turno supera el límite, se conserva completo.
 */
export function trimHistory(messages: readonly ChatMessage[], limit: number): ChatMessage[] {
  if (messages.length <= limit) return [...messages];
  const cut = messages.length - limit;
  for (let i = cut; i < messages.length; i++) {
    if (isTurnStart(messages[i]!)) return messages.slice(i);
  }
  for (let i = cut - 1; i >= 0; i--) {
    if (isTurnStart(messages[i]!)) return messages.slice(i);
  }
  return [];
}

/** Lee el historial guardado. Si está dañado o en un formato anterior, la conversación empieza de cero. */
export function parseHistory(raw: string): ChatMessage[] {
  try {
    const parsed = historySchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as ChatMessage[]) : [];
  } catch {
    return [];
  }
}
