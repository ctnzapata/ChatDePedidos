import type { Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../../src/llm/gemini-provider.ts";
import type { LlmRequest } from "../../src/llm/types.ts";

function fakeClient(response: Record<string, unknown>) {
  const calls: GenerateContentParameters[] = [];
  const generate = async (params: GenerateContentParameters): Promise<GenerateContentResponse> => {
    calls.push(params);
    return response as unknown as GenerateContentResponse;
  };
  return { generate, calls };
}

const usageMetadata = { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 15, thoughtsTokenCount: 5 };
const textResponse = { candidates: [{ content: { role: "model", parts: [{ text: "¡Hola!" }] }, finishReason: "STOP" }], usageMetadata };

const request: LlmRequest = {
  system: "Eres el asistente.",
  maxOutputTokens: 512,
  tools: [{ name: "view_cart", description: "Muestra el carrito", inputSchema: { type: "object", properties: {} } }],
  messages: [
    { role: "user", parts: [{ type: "text", text: "contexto" }, { type: "text", text: "Hola" }] },
    {
      role: "assistant",
      parts: [{ type: "tool_call", id: "fc-1", name: "view_cart", input: {} }],
    },
    { role: "user", parts: [{ type: "tool_result", toolCallId: "fc-1", name: "view_cart", content: "vacío", isError: false }] },
  ],
};

describe("GeminiProvider", () => {
  it("builds contents, system instruction and function declarations", async () => {
    const client = fakeClient(textResponse);
    const provider = new GeminiProvider(client.generate, "gemini-3.5-flash-lite");

    await provider.complete(request);

    const params = client.calls[0];
    expect(params?.model).toBe("gemini-3.5-flash-lite");
    expect(params?.config).toMatchObject({
      systemInstruction: "Eres el asistente.",
      maxOutputTokens: 512,
      tools: [{ functionDeclarations: [{ name: "view_cart", description: "Muestra el carrito", parametersJsonSchema: { type: "object", properties: {} } }] }],
    });
    expect(params?.contents).toEqual([
      { role: "user", parts: [{ text: "contexto" }, { text: "Hola" }] },
      { role: "model", parts: [{ functionCall: { id: "fc-1", name: "view_cart", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "fc-1", name: "view_cart", response: { output: "vacío" } } }] },
    ]);
  });

  it("sends tool errors under the error key", async () => {
    const client = fakeClient(textResponse);
    const provider = new GeminiProvider(client.generate, "m");
    const failing: LlmRequest = {
      ...request,
      messages: [
        ...request.messages.slice(0, 2),
        { role: "user", parts: [{ type: "tool_result", toolCallId: "fc-1", name: "view_cart", content: "falló", isError: true }] },
      ],
    };

    await provider.complete(failing);

    expect(client.calls[0]?.contents).toContainEqual({
      role: "user",
      parts: [{ functionResponse: { id: "fc-1", name: "view_cart", response: { error: "falló" } } }],
    });
  });

  it("replays the original model parts (with thought signatures) when available", async () => {
    const client = fakeClient(textResponse);
    const provider = new GeminiProvider(client.generate, "m");
    const rawParts = [{ functionCall: { name: "view_cart", args: {} }, thoughtSignature: "firma-secreta" }];
    const withRaw: LlmRequest = {
      ...request,
      messages: [
        request.messages[0]!,
        { ...request.messages[1]!, raw: { provider: "gemini", payload: rawParts } },
        request.messages[2]!,
      ],
    };

    await provider.complete(withRaw);

    expect(client.calls[0]?.contents).toContainEqual({ role: "model", parts: rawParts });
  });

  it("maps text responses and usage (thinking tokens count as output)", async () => {
    const provider = new GeminiProvider(fakeClient(textResponse).generate, "m");

    const response = await provider.complete(request);

    expect(response.message.parts).toEqual([{ type: "text", text: "¡Hola!" }]);
    expect(response.stopReason).toBe("end_turn");
    expect(response.usage).toEqual({ input: 100, output: 20, cacheRead: 20, cacheWrite: 0 });
  });

  it("maps function calls, ignores thought parts and keeps the raw parts", async () => {
    const parts = [
      { text: "pensando…", thought: true },
      { functionCall: { name: "add_to_cart", args: { item_code: "HAM-SEN", quantity: 1 } }, thoughtSignature: "sig" },
    ];
    const provider = new GeminiProvider(
      fakeClient({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata }).generate,
      "m",
    );

    const response = await provider.complete(request);

    expect(response.stopReason).toBe("tool_use");
    expect(response.message.parts).toEqual([
      { type: "tool_call", id: expect.any(String), name: "add_to_cart", input: { item_code: "HAM-SEN", quantity: 1 } },
    ]);
    expect(response.message.raw).toEqual({ provider: "gemini", payload: parts });
  });

  it("does not send locally generated ids back to Gemini", async () => {
    const parts = [{ functionCall: { name: "view_cart", args: {} } }];
    const client = fakeClient({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata });
    const provider = new GeminiProvider(client.generate, "m");
    const first = await provider.complete(request);
    const call = first.message.parts[0];
    if (call?.type !== "tool_call") throw new Error("se esperaba una llamada");

    await provider.complete({
      ...request,
      messages: [
        request.messages[0]!,
        { role: "assistant", parts: first.message.parts },
        { role: "user", parts: [{ type: "tool_result", toolCallId: call.id, name: call.name, content: "ok", isError: false }] },
      ],
    });

    expect((client.calls[1]?.contents as Content[]).at(-1)).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "view_cart", response: { output: "ok" } } }],
    });
  });

  it.each([
    ["MAX_TOKENS", "max_tokens"],
    ["SAFETY", "refusal"],
    ["PROHIBITED_CONTENT", "refusal"],
    ["OTHER", "end_turn"],
  ])("maps finish reason %s to %s", async (finishReason, expected) => {
    const provider = new GeminiProvider(
      fakeClient({ candidates: [{ content: { role: "model", parts: [] }, finishReason }], usageMetadata }).generate,
      "m",
    );

    expect((await provider.complete(request)).stopReason).toBe(expected);
  });

  it("treats a blocked prompt as a refusal", async () => {
    const provider = new GeminiProvider(fakeClient({ promptFeedback: { blockReason: "SAFETY" } }).generate, "m");

    const response = await provider.complete(request);

    expect(response.stopReason).toBe("refusal");
    expect(response.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});
