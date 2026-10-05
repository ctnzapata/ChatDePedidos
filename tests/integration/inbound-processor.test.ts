import { beforeEach, describe, expect, it } from "vitest";
import { OrderAgent } from "../../src/agent/order-agent.ts";
import type { LlmResponse } from "../../src/llm/types.ts";
import { parseAgentState } from "../../src/agent/agent-state.ts";
import { ConversationRepository } from "../../src/repositories/conversation-repository.ts";
import { OrderRepository } from "../../src/repositories/order-repository.ts";
import { RestaurantRepository } from "../../src/repositories/restaurant-repository.ts";
import {
  CONFIRM_BUTTON_ID,
  EDIT_BUTTON_ID,
  NO_PENDING_CONFIRMATION_TEXT,
  RATE_LIMITED_TEXT,
  STAFF_GREETING_TEXT,
  TECHNICAL_ERROR_TEXT,
  UNSUPPORTED_MESSAGE_TEXT,
} from "../../src/services/customer-messages.ts";
import { InboundProcessor } from "../../src/services/inbound-processor.ts";
import { SlidingWindowLimiter } from "../../src/lib/rate-limiter.ts";
import type { InboundContent, InboundMessage } from "../../src/whatsapp/webhook-parser.ts";
import {
  CUSTOMER_PHONE,
  MONDAY_3PM,
  STAFF_PHONE,
  TEST_PHONE_NUMBER_ID,
  resetDatabase,
  seedTestStore,
  testPrisma,
} from "../fixtures/db.ts";
import { FakeMessenger } from "../fixtures/fake-messenger.ts";
import { message, scriptedLlm, text, toolUse, type CompleteFn } from "../fixtures/fake-llm.ts";

let messageCounter = 0;
function inbound(content: InboundContent, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    from: CUSTOMER_PHONE,
    waMessageId: `wamid.${++messageCounter}`,
    timestamp: MONDAY_3PM,
    profileName: "Ana",
    content,
    ...overrides,
  };
}
const said = (value: string, overrides: Partial<InboundMessage> = {}) => inbound({ kind: "text", text: value }, overrides);
const tapped = (buttonId: string) => inbound({ kind: "button", buttonId, title: buttonId });

/** Respuestas del LLM para armar un pedido completo para recoger y pedir confirmación. */
const orderScript = (): LlmResponse[] => [
  message(
    [
      toolUse("add_to_cart", { item_code: "HAM-SEN", quantity: 1 }),
      toolUse("set_order_details", { fulfillment: "PICKUP", customer_name: "Ana", payment_method: "CASH" }),
      toolUse("request_order_confirmation", {}),
    ],
    "tool_use",
  ),
  message([text("Te dejo el resumen 👇")], "end_turn"),
];

function setup(responses: LlmResponse[] | CompleteFn) {
  const llm = scriptedLlm(responses);
  const messenger = new FakeMessenger();
  const agent = new OrderAgent(llm.provider, {
    maxOutputTokens: 1024,
    maxIterations: 5,
    historyLimit: 20,
  });
  const processor = new InboundProcessor({
    restaurants: new RestaurantRepository(testPrisma),
    conversations: new ConversationRepository(testPrisma),
    orders: new OrderRepository(testPrisma),
    messenger,
    agent,
    now: () => MONDAY_3PM,
  });
  return { processor, messenger, llm };
}

async function conversationOf(phone = CUSTOMER_PHONE) {
  const customer = await testPrisma.customer.findFirstOrThrow({ where: { phone }, include: { conversation: true } });
  if (!customer.conversation) throw new Error("Sin conversación");
  return customer.conversation;
}

beforeEach(async () => {
  await resetDatabase();
  await seedTestStore();
});

describe("InboundProcessor", () => {
  it("takes an order end to end: agent turn, summary with buttons, confirmation and staff notice", async () => {
    const { processor, messenger, llm } = setup(orderScript());

    await processor.handle(said("Una hamburguesa sencilla para recoger, soy Ana y pago en efectivo"));

    expect(messenger.textsTo(CUSTOMER_PHONE)[0]).toBe("Te dejo el resumen 👇");
    expect(messenger.textsTo(CUSTOMER_PHONE)[1]).toContain("*Total: $18.500*");
    expect(messenger.buttonsTo(CUSTOMER_PHONE)).toHaveLength(1);
    expect(messenger.sent.some((m) => m.kind === "read")).toBe(true);
    const systemPrompt = JSON.stringify(llm.calls[0]?.system);
    expect(systemPrompt).toContain("La Esquina Rápida");
    expect(JSON.stringify(llm.calls[0]?.messages.at(-1))).toContain("ABIERTO");

    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    const order = await testPrisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order).toMatchObject({ number: 1, status: "PENDING", total: 18500, fulfillment: "PICKUP", customerName: "Ana" });
    expect(order.items).toHaveLength(1);
    expect(messenger.textsTo(CUSTOMER_PHONE).at(-1)).toContain("#1");
    expect(messenger.textsTo(STAFF_PHONE)[0]).toContain("Nuevo pedido #1");
    const state = parseAgentState((await conversationOf()).state);
    expect(state.cart.lines).toHaveLength(0);
    expect(state.checkout.customerName).toBe("Ana");
    expect(state.pendingConfirmation).toBeNull();
  });

  it("stores conversation history, usage and logs messages", async () => {
    const { processor } = setup([message([text("¡Hola! ¿Qué te provoca?")], "end_turn")]);

    await processor.handle(said("Hola"));

    const conversation = await conversationOf();
    expect(JSON.parse(conversation.history)).toHaveLength(2);
    expect(conversation.inputTokens).toBe(100);
    expect(await testPrisma.message.count({ where: { conversationId: conversation.id } })).toBe(2);
  });

  it("ignores webhook retries of the same message", async () => {
    const { processor, llm } = setup([message([text("Hola")], "end_turn")]);
    const first = said("Hola");

    await processor.handle(first);
    await processor.handle({ ...first });

    expect(llm.calls).toHaveLength(1);
  });

  it("processes messages of the same customer one at a time", async () => {
    const { processor, llm } = setup([message([text("Uno")], "end_turn"), message([text("Dos")], "end_turn")]);

    await Promise.all([processor.handle(said("primero")), processor.handle(said("segundo"))]);

    // El segundo turno ve el historial completo del primero.
    expect(llm.calls[1]?.messages).toHaveLength(3);
  });

  it("ignores messages for unknown phone numbers", async () => {
    const { processor, messenger, llm } = setup([]);

    await processor.handle(said("Hola", { phoneNumberId: "OTRO" }));

    expect(llm.calls).toHaveLength(0);
    expect(messenger.sent).toHaveLength(0);
  });

  it("answers unsupported message types without calling the model", async () => {
    const { processor, messenger, llm } = setup([]);

    await processor.handle(inbound({ kind: "unsupported", type: "audio" }));

    expect(llm.calls).toHaveLength(0);
    expect(messenger.textsTo(CUSTOMER_PHONE)).toEqual([UNSUPPORTED_MESSAGE_TEXT]);
  });

  it("greets the staff instead of treating them as a customer", async () => {
    const { processor, messenger, llm } = setup([]);

    await processor.handle(said("hola", { from: STAFF_PHONE }));

    expect(llm.calls).toHaveLength(0);
    expect(messenger.textsTo(STAFF_PHONE)).toEqual([STAFF_GREETING_TEXT]);
  });

  it("hands the conversation to a human and forwards later messages to the staff", async () => {
    const { processor, messenger, llm } = setup([
      message([toolUse("transfer_to_human", { reason: "Reclamo por pedido frío" })], "tool_use"),
      message([text("Te comunico con una persona del equipo.")], "end_turn"),
    ]);

    await processor.handle(said("Mi pedido llegó frío, quiero hablar con alguien"));
    await processor.handle(said("¿Hola?"));

    expect((await conversationOf()).mode).toBe("HUMAN");
    expect(messenger.textsTo(STAFF_PHONE)[0]).toContain("Reclamo por pedido frío");
    expect(messenger.textsTo(STAFF_PHONE)[1]).toContain("¿Hola?");
    expect(llm.calls).toHaveLength(2);
  });

  it("says there is nothing to confirm when no confirmation is pending", async () => {
    const { processor, messenger } = setup([]);

    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    expect(messenger.textsTo(CUSTOMER_PHONE)).toEqual([NO_PENDING_CONFIRMATION_TEXT]);
    expect(await testPrisma.order.count()).toBe(0);
  });

  it("asks again when the price changed between the summary and the confirmation", async () => {
    const { processor, messenger } = setup(orderScript());
    await processor.handle(said("Una hamburguesa sencilla para recoger"));
    await testPrisma.menuItem.updateMany({ where: { code: "HAM-SEN" }, data: { price: 20000 } });

    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    expect(await testPrisma.order.count()).toBe(0);
    expect(messenger.textsTo(CUSTOMER_PHONE).join("\n")).toContain("$20.000");
    expect(messenger.buttonsTo(CUSTOMER_PHONE)).toHaveLength(2);
    expect(parseAgentState((await conversationOf()).state).pendingConfirmation).toEqual({ total: 20000 });
  });

  it("clears the pending confirmation when the customer wants to modify the order", async () => {
    const { processor, messenger } = setup(orderScript());
    await processor.handle(said("Una hamburguesa sencilla para recoger"));

    await processor.handle(tapped(EDIT_BUTTON_ID));

    const state = parseAgentState((await conversationOf()).state);
    expect(state.pendingConfirmation).toBeNull();
    expect(state.cart.lines).toHaveLength(1);
    expect(messenger.textsTo(CUSTOMER_PHONE).at(-1)).toContain("qué quieres cambiar");
  });

  it("still creates the order when notifying the staff fails", async () => {
    const { processor, messenger } = setup(orderScript());
    messenger.failingRecipients.add(STAFF_PHONE);
    await processor.handle(said("Una hamburguesa sencilla para recoger"));

    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    expect(await testPrisma.order.count()).toBe(1);
    expect(messenger.textsTo(CUSTOMER_PHONE).at(-1)).toContain("#1");
  });

  it("keeps the order, clears the confirmation and notifies the staff even if the customer reply fails", async () => {
    const { processor, messenger } = setup(orderScript());
    await processor.handle(said("Una hamburguesa sencilla para recoger"));
    messenger.failingRecipients.add(CUSTOMER_PHONE);

    await processor.handle(tapped(CONFIRM_BUTTON_ID));
    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    expect(await testPrisma.order.count()).toBe(1);
    expect(parseAgentState((await conversationOf()).state).pendingConfirmation).toBeNull();
    expect(messenger.textsTo(STAFF_PHONE)[0]).toContain("Nuevo pedido #1");
  });

  it("still hands off to a human when the reply to the customer fails", async () => {
    const { processor, messenger } = setup([
      message([toolUse("transfer_to_human", { reason: "Quiere hablar con alguien" })], "tool_use"),
      message([text("Te comunico con el equipo.")], "end_turn"),
    ]);
    messenger.failingRecipients.add(CUSTOMER_PHONE);

    await processor.handle(said("Quiero hablar con una persona"));

    expect((await conversationOf()).mode).toBe("HUMAN");
    expect(messenger.textsTo(STAFF_PHONE)[0]).toContain("Quiere hablar con alguien");
  });

  it("does not create orders from an old confirmation after closing time", async () => {
    const { processor: openProcessor } = setup(orderScript());
    await openProcessor.handle(said("Una hamburguesa sencilla para recoger"));
    const messenger = new FakeMessenger();
    const closed = new InboundProcessor({
      restaurants: new RestaurantRepository(testPrisma),
      conversations: new ConversationRepository(testPrisma),
      orders: new OrderRepository(testPrisma),
      messenger,
      agent: { runTurn: async () => { throw new Error("no se usa"); } },
      now: () => new Date("2026-10-05T23:30:00-05:00"),
    });

    await closed.handle(tapped(CONFIRM_BUTTON_ID));

    expect(await testPrisma.order.count()).toBe(0);
    expect(messenger.textsTo(CUSTOMER_PHONE)[0]).toContain("cerrado");
  });

  it("limits how many messages a customer can send, warning only once", async () => {
    const llm = scriptedLlm([message([text("Uno")], "end_turn"), message([text("Dos")], "end_turn")]);
    const messenger = new FakeMessenger();
    const processor = new InboundProcessor({
      restaurants: new RestaurantRepository(testPrisma),
      conversations: new ConversationRepository(testPrisma),
      orders: new OrderRepository(testPrisma),
      messenger,
      agent: new OrderAgent(llm.provider, { maxOutputTokens: 1024, maxIterations: 3, historyLimit: 20 }),
      now: () => MONDAY_3PM,
      rateLimiter: new SlidingWindowLimiter(2, 60_000),
    });

    for (const value of ["a", "b", "c", "d"]) await processor.handle(said(value));

    expect(llm.calls).toHaveLength(2);
    expect(messenger.textsTo(CUSTOMER_PHONE)).toEqual(["Uno", "Dos", RATE_LIMITED_TEXT]);
  });

  it("apologizes to the customer when the model fails", async () => {
    const { processor, messenger } = setup(async () => {
      throw new Error("API caída");
    });

    await processor.handle(said("Hola"));

    expect(messenger.textsTo(CUSTOMER_PHONE)).toEqual([TECHNICAL_ERROR_TEXT]);
  });

  it("lets the agent cancel a pending order of the same customer", async () => {
    const { processor } = setup([
      ...orderScript(),
      message([toolUse("cancel_order", { order_number: 1 })], "tool_use"),
      message([text("Listo, cancelé tu pedido #1.")], "end_turn"),
    ]);
    await processor.handle(said("Una hamburguesa sencilla para recoger"));
    await processor.handle(tapped(CONFIRM_BUTTON_ID));

    await processor.handle(said("Mejor cancela el pedido 1"));

    expect((await testPrisma.order.findFirstOrThrow()).status).toBe("CANCELLED");
  });
});
