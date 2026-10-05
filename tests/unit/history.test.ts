import { describe, expect, it } from "vitest";
import { parseHistory, trimHistory } from "../../src/agent/history.ts";
import type { ChatMessage } from "../../src/llm/types.ts";

const user = (text: string): ChatMessage => ({ role: "user", parts: [{ type: "text", text }] });
const assistant = (text: string): ChatMessage => ({ role: "assistant", parts: [{ type: "text", text }] });
const toolResult: ChatMessage = {
  role: "user",
  parts: [{ type: "tool_result", toolCallId: "t1", name: "view_cart", content: "ok", isError: false }],
};
const toolCall: ChatMessage = {
  role: "assistant",
  parts: [{ type: "tool_call", id: "t1", name: "view_cart", input: {} }],
};

describe("trimHistory", () => {
  it("keeps everything under the limit", () => {
    const history = [user("a"), assistant("b")];

    expect(trimHistory(history, 10)).toEqual(history);
  });

  it("keeps the most recent messages", () => {
    const history = [user("1"), assistant("2"), user("3"), assistant("4")];

    expect(trimHistory(history, 2)).toEqual([user("3"), assistant("4")]);
  });

  it("never starts with a tool result or an assistant message", () => {
    const history = [user("1"), toolCall, toolResult, assistant("2"), user("3"), assistant("4")];

    expect(trimHistory(history, 4)).toEqual([user("3"), assistant("4")]);
  });

  it("extends backwards to the start of the turn when a single turn exceeds the limit", () => {
    const history = [user("1"), toolCall, toolResult, assistant("2")];

    expect(trimHistory(history, 2)).toEqual(history);
  });

  it("returns an empty history when no valid starting point exists", () => {
    expect(trimHistory([toolCall, toolResult], 1)).toEqual([]);
  });
});

describe("parseHistory", () => {
  it("parses stored history including provider raw payloads", () => {
    const history: ChatMessage[] = [
      user("hola"),
      toolCall,
      toolResult,
      { ...assistant("¡Hola!"), raw: { provider: "gemini", payload: [{ text: "¡Hola!", thoughtSignature: "x" }] } },
    ];

    expect(parseHistory(JSON.stringify(history))).toEqual(history);
  });

  it.each([
    "",
    "no-json",
    "{}",
    '[{"role":"system","parts":[]}]',
    // Formato anterior (Anthropic): se descarta y la conversación empieza de cero.
    '[{"role":"user","content":"hola"}]',
  ])("returns [] for invalid or legacy data %#", (raw) => {
    expect(parseHistory(raw)).toEqual([]);
  });
});
