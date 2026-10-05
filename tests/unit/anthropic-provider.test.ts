import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../../src/llm/anthropic-provider.ts";
import type { LlmRequest } from "../../src/llm/types.ts";

function fakeClient(response: Partial<Anthropic.Message>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage = async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    calls.push(params);
    return {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      ...response,
    } as Anthropic.Message;
  };
  return { createMessage, calls };
}

const request: LlmRequest = {
  system: "Eres el asistente.",
  maxOutputTokens: 512,
  tools: [{ name: "view_cart", description: "Muestra el carrito", inputSchema: { type: "object", properties: {} } }],
  messages: [
    { role: "user", parts: [{ type: "text", text: "Hola" }] },
    { role: "assistant", parts: [{ type: "text", text: "Miro" }, { type: "tool_call", id: "t1", name: "view_cart", input: {} }] },
    { role: "user", parts: [{ type: "tool_result", toolCallId: "t1", name: "view_cart", content: "vacío", isError: false }] },
  ],
};

describe("AnthropicProvider", () => {
  it("builds a cached request with tools and Anthropic content blocks", async () => {
    const client = fakeClient({});
    const provider = new AnthropicProvider(client.createMessage, "claude-haiku-4-5");

    await provider.complete(request);

    const params = client.calls[0];
    expect(params).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 512, cache_control: { type: "ephemeral" } });
    expect(params?.system).toEqual([{ type: "text", text: "Eres el asistente.", cache_control: { type: "ephemeral" } }]);
    expect(params?.tools).toEqual([{ name: "view_cart", description: "Muestra el carrito", input_schema: { type: "object", properties: {} } }]);
    expect(params?.messages[1]?.content).toEqual([
      { type: "text", text: "Miro" },
      { type: "tool_use", id: "t1", name: "view_cart", input: {} },
    ]);
    expect(params?.messages[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "vacío", is_error: false }]);
  });

  it("maps the response to neutral parts, stop reason and usage", async () => {
    const client = fakeClient({
      content: [
        { type: "text", text: "Te agrego eso", citations: null },
        { type: "tool_use", id: "t9", name: "add_to_cart", input: { item_code: "HAM-SEN", quantity: 1 } },
      ] as Anthropic.ContentBlock[],
      stop_reason: "tool_use",
    });
    const provider = new AnthropicProvider(client.createMessage, "m");

    const response = await provider.complete(request);

    expect(response.message.parts).toEqual([
      { type: "text", text: "Te agrego eso" },
      { type: "tool_call", id: "t9", name: "add_to_cart", input: { item_code: "HAM-SEN", quantity: 1 } },
    ]);
    expect(response.stopReason).toBe("tool_use");
    expect(response.usage).toEqual({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2 });
  });

  it.each([
    ["max_tokens", "max_tokens"],
    ["refusal", "refusal"],
    ["stop_sequence", "end_turn"],
  ] as const)("maps stop reason %s to %s", async (anthropicReason, expected) => {
    const provider = new AnthropicProvider(fakeClient({ stop_reason: anthropicReason }).createMessage, "m");

    expect((await provider.complete(request)).stopReason).toBe(expected);
  });
});
