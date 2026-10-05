import { describe, expect, it, vi } from "vitest";
import { INITIAL_AGENT_STATE } from "../../src/agent/agent-state.ts";
import { FALLBACK_REPLY, OrderAgent, type AgentSettings } from "../../src/agent/order-agent.ts";
import type { ToolContext } from "../../src/agent/tools.ts";
import type { ChatMessage } from "../../src/llm/types.ts";
import { catalog, policy } from "../fixtures/catalog.ts";
import { message, scriptedLlm, text, toolUse } from "../fixtures/fake-llm.ts";

const settings: AgentSettings = { maxOutputTokens: 1024, maxIterations: 4, historyLimit: 20 };

const context: ToolContext = {
  catalog,
  policy,
  isOpen: true,
  isAcceptingOrders: true,
  openingHoursText: "Todos los días",
  orders: { listRecent: vi.fn().mockResolvedValue([]), cancel: vi.fn() },
};

const turn = (history: ChatMessage[] = []) => ({
  system: "Eres el asistente de pedidos.",
  history,
  userParts: [text("Hola")],
  state: INITIAL_AGENT_STATE,
  context,
});

describe("OrderAgent", () => {
  it("returns the model text and sends system, tools and limits to the provider", async () => {
    const llm = scriptedLlm([message([text("¡Hola! ¿Qué te provoca hoy?")], "end_turn")]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(result.reply).toBe("¡Hola! ¿Qué te provoca hoy?");
    expect(llm.calls[0]).toMatchObject({ system: "Eres el asistente de pedidos.", maxOutputTokens: 1024 });
    expect(llm.calls[0]?.tools.length).toBeGreaterThan(0);
    expect(result.history).toEqual([
      { role: "user", parts: [{ type: "text", text: "Hola" }] },
      { role: "assistant", parts: [{ type: "text", text: "¡Hola! ¿Qué te provoca hoy?" }] },
    ]);
    expect(result.usage).toEqual({ input: 100, output: 20, cacheRead: 50, cacheWrite: 10 });
  });

  it("keeps the provider raw payload of the final answer in the history", async () => {
    const response = message([text("Hola")], "end_turn");
    const llm = scriptedLlm([{ ...response, message: { ...response.message, raw: { provider: "gemini", payload: [{ text: "Hola" }] } } }]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(result.history.at(-1)?.raw).toEqual({ provider: "gemini", payload: [{ text: "Hola" }] });
  });

  it("executes tools, feeds results back and threads the state", async () => {
    const llm = scriptedLlm([
      message([text("Ya te la agrego."), toolUse("add_to_cart", { item_code: "HAM-SEN", quantity: 1 })], "tool_use"),
      message([text("Listo, agregué una hamburguesa sencilla.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(result.reply).toBe("Listo, agregué una hamburguesa sencilla.");
    expect(result.state.cart.lines).toHaveLength(1);
    expect(llm.calls[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      parts: [{ type: "tool_result", name: "add_to_cart", isError: false }],
    });
    expect(result.usage.input).toBe(200);
  });

  it("returns all tool results of a turn in a single user message", async () => {
    const llm = scriptedLlm([
      message(
        [toolUse("add_to_cart", { item_code: "HAM-SEN", quantity: 1 }), toolUse("add_to_cart", { item_code: "BEB-GAS", quantity: 1 })],
        "tool_use",
      ),
      message([text("Listo.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(llm.calls[1]?.messages.at(-1)?.parts).toHaveLength(2);
    expect(result.state.cart.lines.map((l) => l.lineId)).toEqual(["L1", "L2"]);
  });

  it("marks failing tool calls as errors without changing the state", async () => {
    const llm = scriptedLlm([
      message([toolUse("add_to_cart", { item_code: "NOPE", quantity: 1 })], "tool_use"),
      message([text("Ese producto no lo tenemos.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(llm.calls[1]?.messages.at(-1)).toMatchObject({ parts: [{ type: "tool_result", isError: true }] });
    expect(result.state.cart.lines).toHaveLength(0);
  });

  it("treats a tool_use stop without tool calls as a final answer", async () => {
    const llm = scriptedLlm([message([text("Listo")], "tool_use")]);
    const agent = new OrderAgent(llm.provider, settings);

    expect((await agent.runTurn(turn())).reply).toBe("Listo");
    expect(llm.calls).toHaveLength(1);
  });

  it("collects effects emitted by tools", async () => {
    const llm = scriptedLlm([
      message([toolUse("transfer_to_human", { reason: "Cliente pide hablar con alguien" })], "tool_use"),
      message([text("Te comunico con una persona del equipo.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(result.effects).toEqual([{ type: "handoff", reason: "Cliente pide hablar con alguien" }]);
  });

  it("drops a confirmation request made stale by a later cart change in the same turn", async () => {
    const llm = scriptedLlm([
      message(
        [
          toolUse("add_to_cart", { item_code: "HAM-SEN", quantity: 1 }),
          toolUse("set_order_details", { fulfillment: "PICKUP", customer_name: "Ana", payment_method: "CASH" }),
          toolUse("request_order_confirmation", {}),
          toolUse("add_to_cart", { item_code: "BEB-GAS", quantity: 1 }),
        ],
        "tool_use",
      ),
      message([text("Listo.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    expect((await agent.runTurn(turn())).effects).toEqual([]);
  });

  it("keeps only the latest confirmation request", async () => {
    const llm = scriptedLlm([
      message(
        [
          toolUse("add_to_cart", { item_code: "HAM-SEN", quantity: 1 }),
          toolUse("set_order_details", { fulfillment: "PICKUP", customer_name: "Ana", payment_method: "CASH" }),
          toolUse("request_order_confirmation", {}),
          toolUse("request_order_confirmation", {}),
        ],
        "tool_use",
      ),
      message([text("Listo.")], "end_turn"),
    ]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(result.effects.filter((e) => e.type === "request_confirmation")).toHaveLength(1);
  });

  it("stops after the iteration limit and closes the history with an assistant message", async () => {
    const loop = () => message([toolUse("view_cart", {})], "tool_use");
    const llm = scriptedLlm([loop(), loop(), loop(), loop()]);
    const agent = new OrderAgent(llm.provider, settings);

    const result = await agent.runTurn(turn());

    expect(llm.calls).toHaveLength(settings.maxIterations);
    expect(result.reply).toBe(FALLBACK_REPLY);
    expect(result.history.at(-1)?.role).toBe("assistant");
  });

  it("uses the fallback reply when the model refuses or returns no text", async () => {
    const llm = scriptedLlm([message([], "refusal")]);
    const agent = new OrderAgent(llm.provider, settings);

    expect((await agent.runTurn(turn())).reply).toBe(FALLBACK_REPLY);
  });

  it("sends only the trimmed history to the model", async () => {
    const longHistory: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [text(`mensaje ${i}`)],
    }));
    const llm = scriptedLlm([message([text("Ok")], "end_turn")]);
    const agent = new OrderAgent(llm.provider, { ...settings, historyLimit: 6 });

    await agent.runTurn(turn(longHistory));

    const sent = llm.calls[0]?.messages ?? [];
    expect(sent.length).toBeLessThanOrEqual(7);
    expect(sent[0]?.role).toBe("user");
  });
});
