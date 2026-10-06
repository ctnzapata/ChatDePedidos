import type { OrderStatus } from "../domain/order-status.ts";
import { errorMessage, logger as defaultLogger, type Logger } from "../lib/logger.ts";
import { err, ok, type Result } from "../lib/result.ts";
import type {
  ConversationMessage,
  ConversationRepository,
  HumanConversationSummary,
} from "../repositories/conversation-repository.ts";
import type { OrderRepository, PanelOrder, TransitionError } from "../repositories/order-repository.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import type { Messenger } from "../whatsapp/messenger.ts";
import { statusChangedText } from "./customer-messages.ts";

export interface PanelServiceDeps {
  readonly restaurants: RestaurantRepository;
  readonly conversations: ConversationRepository;
  readonly orders: OrderRepository;
  readonly messenger: Messenger;
  readonly logger?: Logger;
}

/** Acciones del panel del restaurante. Todas reciben el restaurante para no cruzar datos entre locales. */
export class PanelService {
  private readonly logger: Logger;

  constructor(private readonly deps: PanelServiceDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  listOrders(restaurantId: string, { includeClosed = false } = {}): Promise<PanelOrder[]> {
    return this.deps.orders.listForPanel(restaurantId, includeClosed);
  }

  async updateOrderStatus(
    restaurantId: string,
    orderId: string,
    status: OrderStatus,
    options: { courierStaffId?: string } = {},
  ): Promise<Result<PanelOrder, TransitionError>> {
    const result = await this.deps.orders.transition(restaurantId, orderId, status, options);
    if (!result.ok) return result;
    await this.notifyCustomer(restaurantId, result.value);
    return result;
  }

  /** Entregas en curso del domiciliario. */
  listDeliveries(restaurantId: string, courierStaffId: string): Promise<PanelOrder[]> {
    return this.deps.orders.listForCourier(restaurantId, courierStaffId);
  }

  /** El domiciliario marca como entregado un pedido asignado a él. */
  async completeDelivery(
    restaurantId: string,
    orderId: string,
    courierStaffId: string,
  ): Promise<Result<PanelOrder, TransitionError>> {
    const result = await this.deps.orders.transition(restaurantId, orderId, "DELIVERED", {
      actingCourierStaffId: courierStaffId,
    });
    if (!result.ok) return result;
    await this.notifyCustomer(restaurantId, result.value);
    return result;
  }

  async getConversationMessages(restaurantId: string, conversationId: string): Promise<Result<ConversationMessage[]>> {
    const messages = await this.deps.conversations.listMessages(restaurantId, conversationId);
    return messages ? ok(messages) : err("Conversación no encontrada.");
  }

  async setAcceptingOrders(restaurantId: string, isAcceptingOrders: boolean): Promise<void> {
    await this.deps.restaurants.setAcceptingOrders(restaurantId, isAcceptingOrders);
  }

  async setItemAvailability(restaurantId: string, code: string, isAvailable: boolean): Promise<Result<void>> {
    const found = await this.deps.restaurants.setAvailability(restaurantId, code, isAvailable);
    return found ? ok(undefined) : err(`No existe el producto o adición ${code}.`);
  }

  listHumanConversations(restaurantId: string): Promise<HumanConversationSummary[]> {
    return this.deps.conversations.listByMode(restaurantId, "HUMAN");
  }

  async resumeAgent(restaurantId: string, conversationId: string): Promise<Result<void>> {
    const found = await this.deps.conversations.setModeForRestaurant(restaurantId, conversationId, "AGENT");
    return found ? ok(undefined) : err("Conversación no encontrada.");
  }

  /** El cambio de estado ya quedó guardado; si el aviso por WhatsApp falla solo se registra. */
  private async notifyCustomer(restaurantId: string, order: PanelOrder): Promise<void> {
    const store = await this.deps.restaurants.findById(restaurantId);
    const text = store ? statusChangedText(order.number, order.status, store.name) : null;
    if (!store || !text) return;
    try {
      await this.deps.messenger.sendText({ phoneNumberId: store.whatsappPhoneNumberId, to: order.customerPhone, text });
      const conversationId = await this.deps.conversations.findIdByCustomer(order.customerId);
      if (conversationId) await this.deps.conversations.recordOutbound(conversationId, "text", text);
    } catch (error: unknown) {
      this.logger.warn({ err: errorMessage(error), orderNumber: order.number }, "No se pudo avisar al cliente");
    }
  }
}
