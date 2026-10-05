import type { Content, GenerateContentParameters, GenerateContentResponse, Part } from "@google/genai";
import type { ChatMessage, ChatPart, LlmProvider, LlmRequest, LlmResponse, StopReason } from "./types.ts";

export type GenerateContentFn = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

const PROVIDER = "gemini";
/** Gemini no siempre devuelve id en las llamadas a función; estos ids locales no se le reenvían. */
const LOCAL_ID_PREFIX = "gemini-local-";
const REFUSAL_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

const withRemoteId = (id: string): { id?: string } => (id.startsWith(LOCAL_ID_PREFIX) ? {} : { id });

function toGeminiPart(part: ChatPart): Part {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "tool_call":
      return { functionCall: { ...withRemoteId(part.id), name: part.name, args: (part.input ?? {}) as Record<string, unknown> } };
    case "tool_result":
      return {
        functionResponse: {
          ...withRemoteId(part.toolCallId),
          name: part.name,
          response: part.isError ? { error: part.content } : { output: part.content },
        },
      };
  }
}

function toContent(message: ChatMessage): Content {
  // Las respuestas del modelo se reenvían tal cual llegaron (con firmas de razonamiento).
  if (message.role === "assistant" && message.raw?.provider === PROVIDER && Array.isArray(message.raw.payload)) {
    return { role: "model", parts: message.raw.payload as Part[] };
  }
  return { role: message.role === "assistant" ? "model" : "user", parts: message.parts.map(toGeminiPart) };
}

function fromParts(parts: readonly Part[]): ChatPart[] {
  return parts.flatMap((part, index): ChatPart[] => {
    if (part.thought) return [];
    if (part.functionCall?.name) {
      return [
        {
          type: "tool_call",
          id: part.functionCall.id ?? `${LOCAL_ID_PREFIX}${index}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        },
      ];
    }
    return part.text ? [{ type: "text", text: part.text }] : [];
  });
}

function toStopReason(response: GenerateContentResponse, parts: readonly ChatPart[]): StopReason {
  if (response.promptFeedback?.blockReason) return "refusal";
  if (parts.some((p) => p.type === "tool_call")) return "tool_use";
  const reason = response.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (reason && REFUSAL_REASONS.has(reason)) return "refusal";
  return "end_turn";
}

/** Gemini vía la API de Google AI Studio (SDK @google/genai). */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(
    private readonly generate: GenerateContentFn,
    readonly model: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.generate({
      model: this.model,
      contents: request.messages.map(toContent),
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.maxOutputTokens,
        tools: [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.inputSchema,
            })),
          },
        ],
      },
    });

    const rawParts = response.candidates?.[0]?.content?.parts ?? [];
    const parts = fromParts(rawParts);
    const usage = response.usageMetadata;
    const cached = usage?.cachedContentTokenCount ?? 0;
    return {
      message: { role: "assistant", parts, raw: { provider: PROVIDER, payload: rawParts } },
      stopReason: toStopReason(response, parts),
      usage: {
        input: (usage?.promptTokenCount ?? 0) - cached,
        // Los tokens de razonamiento se cobran como salida.
        output: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheRead: cached,
        cacheWrite: 0,
      },
    };
  }
}
