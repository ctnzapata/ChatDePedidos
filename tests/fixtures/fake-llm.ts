import type { ChatPart, LlmProvider, LlmRequest, LlmResponse, StopReason } from "../../src/llm/types.ts";

export const text = (value: string): ChatPart => ({ type: "text", text: value });

let toolCounter = 0;
export const toolUse = (name: string, input: Record<string, unknown>): ChatPart => ({
  type: "tool_call",
  id: `call_${++toolCounter}`,
  name,
  input,
});

export function message(parts: ChatPart[], stopReason: StopReason): LlmResponse {
  return {
    message: { role: "assistant", parts },
    stopReason,
    usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10 },
  };
}

export type CompleteFn = (request: LlmRequest) => Promise<LlmResponse>;

/** Proveedor falso: devuelve respuestas guionizadas en orden (o usa una función) y guarda cada petición. */
export function scriptedLlm(responses: LlmResponse[] | CompleteFn): { provider: LlmProvider; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const queue = Array.isArray(responses) ? [...responses] : [];
  const provider: LlmProvider = {
    name: "anthropic",
    model: "fake-model",
    async complete(request) {
      // Copia profunda: el agente sigue agregando mensajes al mismo arreglo después de la llamada.
      calls.push(structuredClone(request));
      if (typeof responses === "function") return responses(request);
      const next = queue.shift();
      if (!next) throw new Error("El LLM falso se quedó sin respuestas");
      return next;
    },
  };
  return { provider, calls };
}
