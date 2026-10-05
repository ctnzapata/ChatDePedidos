import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatPart, LlmProvider, LlmRequest, LlmResponse, StopReason } from "./types.ts";

export type CreateMessageFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

function toBlock(part: ChatPart): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool_call":
      return { type: "tool_use", id: part.id, name: part.name, input: part.input };
    case "tool_result":
      return { type: "tool_result", tool_use_id: part.toolCallId, content: part.content, is_error: part.isError };
  }
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  return { role: message.role, content: message.parts.map(toBlock) };
}

function fromContent(content: readonly Anthropic.ContentBlock[]): ChatPart[] {
  return content.flatMap((block): ChatPart[] => {
    if (block.type === "text") return [{ type: "text", text: block.text }];
    if (block.type === "tool_use") return [{ type: "tool_call", id: block.id, name: block.name, input: block.input }];
    return [];
  });
}

function toStopReason(reason: Anthropic.Message["stop_reason"]): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end_turn";
  }
}

/** Claude vía la Messages API, con caché de prompts. */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(
    private readonly createMessage: CreateMessageFn,
    readonly model: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.createMessage({
      model: this.model,
      max_tokens: request.maxOutputTokens,
      // Herramientas + system son estables por restaurante: el bloque cacheado cubre ambos.
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      })),
      messages: request.messages.map(toAnthropicMessage),
      // Caché automática del historial, útil cuando la conversación crece.
      cache_control: { type: "ephemeral" },
    });
    return {
      message: { role: "assistant", parts: fromContent(response.content) },
      stopReason: toStopReason(response.stop_reason),
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
