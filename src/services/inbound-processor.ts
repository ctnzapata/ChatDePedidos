import type { AgentState } from "../agent/agent-state.ts";
import type { AgentTurnInput, AgentTurnResult } from "../agent/order-agent.ts";
import { buildSystemPrompt, buildTurnContext } from "../agent/system-prompt.ts";
import type { CustomerOrdersPort } from "../agent/tools.ts";
import { EMPTY_CART } from "../domain/cart.ts";
import { buildQuote, type Quote } from "../domain/checkout.ts";
import { describeOpeningHours, isOpenAt } from "../domain/hours.ts";
import type { StoreProfile } from "../domain/store.ts";
import { KeyedSerialQueue } from "../lib/keyed-queue.ts";
import type { ChatMessage } from "../llm/types.ts";
import { SlidingWindowLimiter } from "../lib/rate-limiter.ts";
import { errorMessage, logger as defaultLogger, type Logger } from "../lib/logger.ts";
import type { ConversationRecord, ConversationRepository } from "../repositories/conversation-repository.ts";
import type { OrderRepository } from "../repositories/order-repository.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import type { Messenger, ReplyButton } from "../whatsapp/messenger.ts";
import type { InboundMessage } from "../whatsapp/webhook-parser.ts";
import {
  CONFIRMATION_BUTTONS,
  CONFIRM_BUTTON_ID,
  EDIT_BUTTON_ID,
  EDIT_ORDER_REPLY,
  NO_PENDING_CONFIRMATION_TEXT,
  ORDERS_PAUSED_TEXT,
  RATE_LIMITED_TEXT,
  STAFF_GREETING_TEXT,
  TECHNICAL_ERROR_TEXT,
  UNSUPPORTED_MESSAGE_TEXT,
  confirmationPrompt,
  orderConfirmedText,
  quoteChangedText,
  renderQuoteSummary,
  staffForwardText,
  staffHandoffText,
  staffNewOrderText,
  storeClosedText,
} from "./customer-messages.ts";

/** Recorta mensajes muy largos para controlar el costo en tokens. */
export const MAX_INBOUND_TEXT_LENGTH = 1000;

export interface AgentRunner {
  runTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
}

export interface InboundProcessorDeps {
  readonly restaurants: RestaurantRepository;
  readonly conversations: ConversationRepository;
  readonly orders: OrderRepository;
  readonly messenger: Messenger;
  readonly agent: AgentRunner;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Límite de mensajes por cliente; protege el gasto en tokens y al personal de spam. */
  readonly rateLimiter?: SlidingWindowLimiter;
}

const MESSAGES_PER_MINUTE = 10;
const ONE_MINUTE_MS = 60_000;

interface Session {
  readonly store: StoreProfile;
  readonly conversation: ConversationRecord;
}

/** Agrega al historial un intercambio resuelto sin el modelo (p. ej. un botón) para que el agente lo vea. */
function withScriptedExchange(history: readonly ChatMessage[], userNote: string, reply: string): ChatMessage[] {
  return [
    ...history,
    { role: "user", parts: [{ type: "text", text: userNote }] },
    { role: "assistant", parts: [{ type: "text", text: reply }] },
  ];
}

function describeContent(message: InboundMessage): { type: string; body: string } {
  switch (message.content.kind) {
    case "text":
      return { type: "text", body: message.content.text };
    case "button":
      return { type: "button", body: `${message.content.buttonId}: ${message.content.title}` };
    case "unsupported":
      return { type: message.content.type, body: `[${message.content.type}]` };
  }
}

/** Orquesta cada mensaje entrante: idempotencia, modo humano, botones y turnos del agente. */
export class InboundProcessor {
  private readonly queue = new KeyedSerialQueue();
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly rateLimiter: SlidingWindowLimiter;

  constructor(private readonly deps: InboundProcessorDeps) {
    this.logger = deps.logger ?? defaultLogger;
    this.now = deps.now ?? (() => new Date());
    this.rateLimiter = deps.rateLimiter ?? new SlidingWindowLimiter(MESSAGES_PER_MINUTE, ONE_MINUTE_MS);
  }

  /** Nunca lanza: los errores se registran y el cliente recibe una disculpa. */
  handle(message: InboundMessage): Promise<void> {
    return this.queue.run(`${message.phoneNumberId}:${message.from}`, () => this.safeProcess(message));
  }

  private async safeProcess(message: InboundMessage): Promise<void> {
    try {
      await this.process(message);
    } catch (error: unknown) {
      this.logger.error({ err: errorMessage(error), waMessageId: message.waMessageId }, "Error procesando mensaje");
      await this.deps.messenger
        .sendText({ phoneNumberId: message.phoneNumberId, to: message.from, text: TECHNICAL_ERROR_TEXT })
        .catch((sendError: unknown) => this.logger.error({ err: errorMessage(sendError) }, "No se pudo enviar la disculpa"));
    }
  }

  private async process(message: InboundMessage): Promise<void> {
    const store = await this.deps.restaurants.findByPhoneNumberId(message.phoneNumberId);
    if (!store) {
      this.logger.warn({ phoneNumberId: message.phoneNumberId }, "Mensaje para un número sin restaurante configurado");
      return;
    }
    if (store.staffPhone && message.from === store.staffPhone) {
      await this.deps.messenger.sendText({ phoneNumberId: store.whatsappPhoneNumberId, to: message.from, text: STAFF_GREETING_TEXT });
      return;
    }

    const conversation = await this.deps.conversations.getOrCreate(store.id, message.from, message.profileName);
    const { type, body } = describeContent(message);
    const isNew = await this.deps.conversations.recordInbound(conversation.id, message.waMessageId, type, body);
    if (!isNew) {
      this.logger.debug({ waMessageId: message.waMessageId }, "Mensaje duplicado ignorado");
      return;
    }
    await this.deps.messenger
      .markAsRead({ phoneNumberId: store.whatsappPhoneNumberId, messageId: message.waMessageId })
      .catch((error: unknown) => this.logger.warn({ err: errorMessage(error) }, "No se pudo marcar como leído"));

    const session: Session = { store, conversation };
    const rate = this.rateLimiter.check(`${store.id}:${message.from}`);
    if (!rate.allowed) {
      this.logger.warn({ from: message.from }, "Cliente superó el límite de mensajes");
      if (rate.firstRejection) await this.reply(session, RATE_LIMITED_TEXT);
      return;
    }
    if (conversation.mode === "HUMAN") {
      await this.notifyStaff(store, staffForwardText(this.customerLabel(conversation), conversation.customerPhone, body));
      return;
    }

    switch (message.content.kind) {
      case "unsupported":
        await this.reply(session, UNSUPPORTED_MESSAGE_TEXT);
        return;
      case "button":
        await this.handleButton(session, message.content.buttonId, message.content.title);
        return;
      case "text":
        await this.handleText(session, message.content.text.slice(0, MAX_INBOUND_TEXT_LENGTH));
        return;
    }
  }

  /** Ejecuta un envío que no debe interrumpir el flujo si falla (WhatsApp caído, ventana de 24 h). */
  private async attempt(label: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.logger.error({ err: errorMessage(error) }, `Falló: ${label}`);
    }
  }

  private async handleText({ store, conversation }: Session, text: string): Promise<void> {
    const catalog = await this.deps.restaurants.loadCatalog(store.id);
    const now = this.now();
    const result = await this.deps.agent.runTurn({
      system: buildSystemPrompt(store, catalog),
      history: conversation.history,
      userParts: [
        { type: "text", text: buildTurnContext(store, now) },
        { type: "text", text },
      ],
      state: conversation.state,
      context: {
        catalog,
        policy: store.policy,
        isOpen: isOpenAt(store.openingHours, now, store.timezone),
        isAcceptingOrders: store.isAcceptingOrders,
        openingHoursText: describeOpeningHours(store.openingHours),
        orders: this.ordersPortFor({ store, conversation }),
      },
    });
    // Guardar antes de enviar: si WhatsApp falla, el carrito no se pierde.
    await this.deps.conversations.saveTurn(conversation.id, result);
    const session: Session = { store, conversation: { ...conversation, state: result.state, history: result.history } };
    // Los cambios de estado van primero: no dependen de que WhatsApp entregue la respuesta.
    for (const effect of result.effects) {
      if (effect.type === "handoff") await this.startHandoff(session, effect.reason);
    }
    await this.attempt("respuesta del agente", () => this.reply(session, result.reply));
    for (const effect of result.effects) {
      if (effect.type === "request_confirmation") await this.attempt("resumen del pedido", () => this.sendQuote(session, effect.quote));
    }
  }

  private async startHandoff(session: Session, reason: string): Promise<void> {
    await this.deps.conversations.setMode(session.conversation.id, "HUMAN");
    await this.notifyStaff(
      session.store,
      staffHandoffText(this.customerLabel(session.conversation), session.conversation.customerPhone, reason),
    );
  }

  private async handleButton(session: Session, buttonId: string, title: string): Promise<void> {
    if (buttonId === CONFIRM_BUTTON_ID) return this.confirmOrder(session);
    if (buttonId === EDIT_BUTTON_ID) {
      const state: AgentState = { ...session.conversation.state, pendingConfirmation: null };
      return this.saveScriptedExchange(session, state, "[Tocó el botón: Modificar]", EDIT_ORDER_REPLY);
    }
    // Botones desconocidos (p. ej. de plantillas) se tratan como texto.
    return this.handleText(session, title);
  }

  private async confirmOrder(session: Session): Promise<void> {
    const { store, conversation } = session;
    const pending = conversation.state.pendingConfirmation;
    if (!pending) return this.reply(session, NO_PENDING_CONFIRMATION_TEXT);
    if (!store.isAcceptingOrders) return this.reply(session, ORDERS_PAUSED_TEXT);
    if (!isOpenAt(store.openingHours, this.now(), store.timezone)) {
      return this.reply(session, storeClosedText(describeOpeningHours(store.openingHours)));
    }

    const catalog = await this.deps.restaurants.loadCatalog(store.id);
    const quote = buildQuote(conversation.state.cart, catalog, conversation.state.checkout, store.policy);
    if (!quote.ok) {
      const state: AgentState = { ...conversation.state, pendingConfirmation: null };
      const text = `No pude confirmar tu pedido:\n- ${quote.error.join("\n- ")}\n¿Lo ajustamos?`;
      return this.saveScriptedExchange(session, state, "[Tocó el botón: Confirmar pedido]", text);
    }
    if (quote.value.total !== pending.total) {
      const state: AgentState = { ...conversation.state, pendingConfirmation: { total: quote.value.total } };
      await this.saveScriptedExchange(session, state, "[Tocó el botón: Confirmar pedido]", quoteChangedText(quote.value.total));
      return this.sendQuote(session, quote.value);
    }

    // Se conservan nombre y dirección para el próximo pedido; carrito y confirmación se limpian.
    const { customerName, address, addressNotes } = conversation.state.checkout;
    const state: AgentState = {
      cart: EMPTY_CART,
      checkout: { customerName, address, addressNotes },
      pendingConfirmation: null,
    };
    const confirmationFor = (orderNumber: number): string =>
      orderConfirmedText({ ...quote.value, number: orderNumber }, store);

    // Pedido y conversación se guardan en la misma transacción: un segundo toque en
    // "Confirmar" ya no encuentra confirmación pendiente aunque después falle el envío.
    const order = await this.deps.orders.createFromQuote({
      restaurantId: store.id,
      customerId: conversation.customerId,
      quote: quote.value,
      conversationAfterCreate: (orderNumber) => ({
        conversationId: conversation.id,
        state,
        history: withScriptedExchange(
          conversation.history,
          "[Tocó el botón: Confirmar pedido]",
          confirmationFor(orderNumber),
        ),
      }),
    });
    this.logger.info({ orderNumber: order.number, restaurant: store.slug, total: quote.value.total }, "Pedido creado");

    // Con el pedido ya creado, ningún fallo de envío debe mostrar el error genérico.
    await this.attempt("confirmación al cliente", () => this.reply(session, confirmationFor(order.number)));
    await this.notifyStaff(store, staffNewOrderText(order.number, quote.value, conversation.customerPhone));
  }

  /** Guarda un intercambio resuelto sin el modelo para que el agente lo vea en el historial. */
  private async saveScriptedExchange(session: Session, state: AgentState, userNote: string, reply: string): Promise<void> {
    const history = withScriptedExchange(session.conversation.history, userNote, reply);
    await this.deps.conversations.saveTurn(session.conversation.id, { state, history });
    await this.reply(session, reply);
  }

  private async sendQuote(session: Session, quote: Quote): Promise<void> {
    await this.reply(session, renderQuoteSummary(quote));
    await this.sendButtons(session, confirmationPrompt(quote.total), CONFIRMATION_BUTTONS);
  }

  private ordersPortFor({ store, conversation }: Session): CustomerOrdersPort {
    return {
      listRecent: () => this.deps.orders.listRecentForCustomer(conversation.customerId),
      cancel: async (orderNumber) => {
        const result = await this.deps.orders.cancelByCustomer(conversation.customerId, orderNumber);
        if (result.ok) {
          await this.notifyStaff(store, `❌ El cliente ${this.customerLabel(conversation)} canceló el pedido #${orderNumber}.`);
        }
        return result;
      },
    };
  }

  private async reply({ store, conversation }: Session, text: string): Promise<void> {
    await this.deps.messenger.sendText({ phoneNumberId: store.whatsappPhoneNumberId, to: conversation.customerPhone, text });
    await this.deps.conversations.recordOutbound(conversation.id, "text", text);
  }

  private async sendButtons({ store, conversation }: Session, body: string, buttons: readonly ReplyButton[]): Promise<void> {
    await this.deps.messenger.sendButtons({
      phoneNumberId: store.whatsappPhoneNumberId,
      to: conversation.customerPhone,
      body,
      buttons,
    });
    await this.deps.conversations.recordOutbound(conversation.id, "buttons", body);
  }

  /**
   * Avisos al WhatsApp del personal. Fuera de la ventana de 24 h WhatsApp los rechaza,
   * por eso un fallo aquí nunca interrumpe el pedido: el panel es la fuente de verdad.
   */
  private async notifyStaff(store: StoreProfile, text: string): Promise<void> {
    if (!store.staffPhone) {
      this.logger.info({ restaurant: store.slug }, "Restaurante sin staffPhone; aviso solo en el panel");
      return;
    }
    await this.deps.messenger
      .sendText({ phoneNumberId: store.whatsappPhoneNumberId, to: store.staffPhone, text })
      .catch((error: unknown) => this.logger.warn({ err: errorMessage(error) }, "No se pudo avisar al personal"));
  }

  private customerLabel(conversation: ConversationRecord): string {
    return conversation.state.checkout.customerName ?? conversation.customerName ?? "Cliente";
  }
}
