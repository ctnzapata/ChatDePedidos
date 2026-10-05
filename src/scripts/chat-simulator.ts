import { createInterface } from "node:readline/promises";
import { createLlmProvider } from "../llm/create-provider.ts";
import { INITIAL_AGENT_STATE } from "../agent/agent-state.ts";
import { OrderAgent } from "../agent/order-agent.ts";
import { loadDotEnv, parseBaseConfig } from "../config/env.ts";
import { createDb } from "../db/client.ts";
import { isOpenAt } from "../domain/hours.ts";
import type { StoreProfile } from "../domain/store.ts";
import { logger } from "../lib/logger.ts";
import { ConversationRepository } from "../repositories/conversation-repository.ts";
import { OrderRepository } from "../repositories/order-repository.ts";
import { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import { CONFIRM_BUTTON_ID, EDIT_BUTTON_ID } from "../services/customer-messages.ts";
import { InboundProcessor } from "../services/inbound-processor.ts";
import type { InboundContent } from "../whatsapp/webhook-parser.ts";
import { ConsoleMessenger } from "./console-messenger.ts";

// Uso: npm run chat [-- --telefono 573001234567] [-- --siempre-abierto]
// Conversa con el agente real (Claude) desde la terminal, sin WhatsApp. Consume tokens de tu cuenta.

// Precios de referencia de Claude Haiku 4.5 en USD por millón de tokens (verificar en anthropic.com/pricing).
const PRICE_PER_MTOK = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
const HALF_HOUR_MS = 30 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Primer instante (desde ahora) en que el local está abierto, para probar fuera de horario. */
function nextOpenInstant(store: StoreProfile, from: Date): Date {
  for (let t = from.getTime(); t < from.getTime() + WEEK_MS; t += HALF_HOUR_MS) {
    const candidate = new Date(t);
    if (isOpenAt(store.openingHours, candidate, store.timezone)) return candidate;
  }
  return from;
}

async function run(): Promise<void> {
  loadDotEnv();
  const config = parseBaseConfig(process.env);
  logger.level = process.env.LOG_LEVEL_SIMULATOR ?? "warn";
  const customerPhone = argValue("--telefono") ?? "573000000001";
  const alwaysOpen = process.argv.includes("--siempre-abierto");

  const db = createDb();
  const restaurants = new RestaurantRepository(db);
  const conversations = new ConversationRepository(db);
  const [store] = await restaurants.listAll();
  if (!store) throw new Error("No hay restaurantes. Ejecuta primero: npm run db:setup");

  const provider = createLlmProvider(config);
  const agent = new OrderAgent(provider, {
    maxOutputTokens: config.agentMaxOutputTokens,
    maxIterations: config.agentMaxIterations,
    historyLimit: config.agentHistoryLimit,
  });
  const fixedNow = alwaysOpen ? nextOpenInstant(store, new Date()) : undefined;
  const processor = new InboundProcessor({
    restaurants,
    conversations,
    orders: new OrderRepository(db),
    messenger: new ConsoleMessenger(customerPhone),
    agent,
    ...(fixedNow ? { now: () => fixedNow } : {}),
  });

  process.stdout.write(
    `\n🍔 Simulador de ${store.name} — modelo ${provider.name}/${provider.model}, cliente +${customerPhone}` +
      `${fixedNow ? " (local forzado a abierto)" : ""}\n` +
      "Comandos: /confirmar  /modificar  /reiniciar  /costo  /salir\n",
  );

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let counter = 0;
  const send = (content: InboundContent) =>
    processor.handle({
      phoneNumberId: store.whatsappPhoneNumberId,
      from: customerPhone,
      waMessageId: `sim.${Date.now()}.${++counter}`,
      timestamp: new Date(),
      profileName: "Cliente de prueba",
      content,
    });

  const printCost = async (): Promise<void> => {
    const conversation = await conversations.getOrCreate(store.id, customerPhone);
    const row = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    const usd =
      (row.inputTokens * PRICE_PER_MTOK.input +
        row.outputTokens * PRICE_PER_MTOK.output +
        row.cacheReadTokens * PRICE_PER_MTOK.cacheRead +
        row.cacheWriteTokens * PRICE_PER_MTOK.cacheWrite) /
      1_000_000;
    const cost =
      provider.name === "anthropic"
        ? `Costo estimado (tarifa Haiku 4.5): US$${usd.toFixed(4)}`
        : "Costo: US$0 en el plan gratuito de Gemini (en el plan de pago, revisa ai.google.dev/pricing)";
    process.stdout.write(
      `\nTokens — entrada: ${row.inputTokens}, salida: ${row.outputTokens}, caché leída: ${row.cacheReadTokens}, ` +
        `caché escrita: ${row.cacheWriteTokens}. ${cost}\n`,
    );
  };

  try {
    for (;;) {
      const line = (await readline.question("\nTú: ")).trim();
      if (!line) continue;
      if (line === "/salir") break;
      if (line === "/costo") await printCost();
      else if (line === "/confirmar") await send({ kind: "button", buttonId: CONFIRM_BUTTON_ID, title: "Confirmar pedido" });
      else if (line === "/modificar") await send({ kind: "button", buttonId: EDIT_BUTTON_ID, title: "Modificar" });
      else if (line === "/reiniciar") {
        const conversation = await conversations.getOrCreate(store.id, customerPhone);
        await conversations.saveTurn(conversation.id, { state: INITIAL_AGENT_STATE, history: [] });
        await conversations.setMode(conversation.id, "AGENT");
        process.stdout.write("Conversación reiniciada.\n");
      } else await send({ kind: "text", text: line });
    }
    await printCost();
  } finally {
    readline.close();
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
