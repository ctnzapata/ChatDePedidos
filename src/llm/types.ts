/**
 * Formato neutral de conversación: el agente y el historial guardado no dependen de ningún proveedor.
 * Cada adaptador (Anthropic, Gemini) traduce desde y hacia este formato.
 */

export type ChatPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly input: unknown }
  | {
      readonly type: "tool_result";
      readonly toolCallId: string;
      /** Gemini identifica las respuestas de función por nombre. */
      readonly name: string;
      readonly content: string;
      readonly isError: boolean;
    };

export interface RawProviderPayload {
  readonly provider: string;
  readonly payload: unknown;
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly parts: readonly ChatPart[];
  /**
   * Respuesta original del proveedor (p. ej. partes de Gemini con firmas de razonamiento)
   * para reenviarla tal cual cuando el proveedor lo exige.
   */
  readonly raw?: RawProviderPayload;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema del input. */
  readonly inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxOutputTokens: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export interface LlmResponse {
  readonly message: ChatMessage;
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
}

export type LlmProviderName = "anthropic" | "gemini";

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
