import { logger as defaultLogger, type Logger } from "../lib/logger.ts";
import {
  ZERO_USAGE,
  addUsage,
  type ChatMessage,
  type ChatPart,
  type LlmProvider,
  type TokenUsage,
} from "../llm/types.ts";
import type { AgentState } from "./agent-state.ts";
import { trimHistory } from "./history.ts";
import { TOOL_DEFINITIONS, executeTool, type AgentEffect, type ToolContext } from "./tools.ts";

export const FALLBACK_REPLY = "Uy, se me enredó la respuesta 😅 ¿Me lo repites, por favor?";

export interface AgentSettings {
  readonly maxOutputTokens: number;
  /** Llamadas máximas al modelo por mensaje del cliente: corta bucles de herramientas. */
  readonly maxIterations: number;
  readonly historyLimit: number;
}

export interface AgentTurnInput {
  readonly system: string;
  readonly history: readonly ChatMessage[];
  readonly userParts: readonly ChatPart[];
  readonly state: AgentState;
  readonly context: ToolContext;
}

export interface AgentTurnResult {
  readonly reply: string;
  readonly history: ChatMessage[];
  readonly state: AgentState;
  readonly effects: readonly AgentEffect[];
  readonly usage: TokenUsage;
}

function textOf(parts: readonly ChatPart[]): string {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/** Agente de pedidos: bucle de herramientas sobre cualquier proveedor de LLM. */
export class OrderAgent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly settings: AgentSettings,
    private readonly logger: Logger = defaultLogger,
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      ...trimHistory(input.history, this.settings.historyLimit),
      { role: "user", parts: input.userParts },
    ];
    let state = input.state;
    let usage = ZERO_USAGE;
    let reply: string | undefined;
    let lastIntermediateText = "";
    const effects: AgentEffect[] = [];

    for (let iteration = 0; iteration < this.settings.maxIterations && reply === undefined; iteration++) {
      const response = await this.provider.complete({
        system: input.system,
        messages: [...messages],
        tools: TOOL_DEFINITIONS,
        maxOutputTokens: this.settings.maxOutputTokens,
      });
      usage = addUsage(usage, response.usage);
      const text = textOf(response.message.parts);
      const toolCalls = response.message.parts.filter(
        (part): part is Extract<ChatPart, { type: "tool_call" }> => part.type === "tool_call",
      );

      if (response.stopReason !== "tool_use" || toolCalls.length === 0) {
        if (response.stopReason === "refusal" || response.stopReason === "max_tokens") {
          this.logger.warn({ stopReason: response.stopReason }, "Respuesta del agente incompleta");
        }
        reply = text || lastIntermediateText || FALLBACK_REPLY;
        // Se guarda la respuesta original (con sus firmas) solo si es exactamente lo que se le mostró al cliente.
        messages.push(
          reply === text && !toolCalls.length
            ? { ...response.message, parts: [{ type: "text", text }] }
            : { role: "assistant", parts: [{ type: "text", text: reply }] },
        );
        break;
      }

      if (text) lastIntermediateText = text;
      messages.push(response.message);
      const toolResults: ChatPart[] = [];
      for (const call of toolCalls) {
        const outcome = await executeTool(call.name, call.input, state, input.context);
        state = outcome.state;
        effects.push(...outcome.effects);
        toolResults.push({
          type: "tool_result",
          toolCallId: call.id,
          name: call.name,
          content: outcome.result,
          isError: outcome.isError,
        });
      }
      messages.push({ role: "user", parts: toolResults });
    }

    if (reply === undefined) {
      this.logger.warn({ maxIterations: this.settings.maxIterations }, "El agente alcanzó el límite de iteraciones");
      reply = FALLBACK_REPLY;
      messages.push({ role: "assistant", parts: [{ type: "text", text: reply }] });
    }

    const finalEffects = finalizeEffects(effects, state);
    this.logger.info(
      { provider: this.provider.name, model: this.provider.model, usage, effects: finalEffects.map((e) => e.type) },
      "Turno del agente completado",
    );
    return { reply, history: trimHistory(messages, this.settings.historyLimit), state, effects: finalEffects, usage };
  }
}

/**
 * Deja solo la última solicitud de confirmación y solo si sigue vigente
 * (una herramienta posterior del mismo turno pudo cambiar el carrito), y un único traspaso a humano.
 */
function finalizeEffects(effects: readonly AgentEffect[], state: AgentState): AgentEffect[] {
  const lastQuote = effects.findLast((e) => e.type === "request_confirmation");
  const quoteIsCurrent =
    lastQuote?.type === "request_confirmation" && state.pendingConfirmation?.total === lastQuote.quote.total;
  const handoff = effects.find((e) => e.type === "handoff");
  return [...(quoteIsCurrent && lastQuote ? [lastQuote] : []), ...(handoff ? [handoff] : [])];
}
