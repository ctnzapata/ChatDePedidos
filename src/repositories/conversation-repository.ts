import { parseAgentState, type AgentState } from "../agent/agent-state.ts";
import { parseHistory } from "../agent/history.ts";
import type { ChatMessage, TokenUsage } from "../llm/types.ts";
import { isUniqueViolation, toJson, type Db } from "../db/client.ts";

export type ConversationMode = "AGENT" | "HUMAN";

export interface ConversationRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly customerPhone: string;
  readonly customerName: string | null;
  readonly mode: ConversationMode;
  readonly state: AgentState;
  readonly history: ChatMessage[];
}

export interface HumanConversationSummary {
  readonly id: string;
  readonly customerName: string | null;
  readonly customerPhone: string;
  readonly updatedAt: Date;
}

export interface SaveTurnInput {
  readonly state: AgentState;
  readonly history: readonly ChatMessage[];
  readonly usage?: TokenUsage;
}

const MAX_LOGGED_BODY_LENGTH = 4000;
const TRANSCRIPT_LIMIT = 200;

export interface ConversationMessage {
  readonly id: string;
  readonly direction: "IN" | "OUT";
  readonly type: string;
  readonly body: string;
  readonly createdAt: Date;
}

export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /** Obtiene la conversación del cliente en este restaurante, creando cliente y conversación si no existen. */
  async getOrCreate(restaurantId: string, phone: string, profileName?: string): Promise<ConversationRecord> {
    const customer = await this.db.customer.upsert({
      where: { restaurantId_phone: { restaurantId, phone } },
      create: { restaurantId, phone, name: profileName ?? null },
      update: profileName ? { name: profileName } : {},
    });
    const conversation = await this.db.conversation.upsert({
      where: { customerId: customer.id },
      create: { restaurantId, customerId: customer.id },
      update: {},
    });
    return {
      id: conversation.id,
      restaurantId,
      customerId: customer.id,
      customerPhone: customer.phone,
      customerName: customer.name,
      mode: conversation.mode === "HUMAN" ? "HUMAN" : "AGENT",
      state: parseAgentState(conversation.state),
      history: parseHistory(conversation.history),
    };
  }

  /** Registra un mensaje entrante. Devuelve false si ya se había recibido (reintento del webhook). */
  async recordInbound(conversationId: string, waMessageId: string, type: string, body: string): Promise<boolean> {
    try {
      await this.db.message.create({
        data: { conversationId, direction: "IN", waMessageId, type, body: body.slice(0, MAX_LOGGED_BODY_LENGTH) },
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
    await this.db.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date() } });
    return true;
  }

  async recordOutbound(conversationId: string, type: string, body: string): Promise<void> {
    await this.db.message.create({
      data: { conversationId, direction: "OUT", type, body: body.slice(0, MAX_LOGGED_BODY_LENGTH) },
    });
  }

  async findIdByCustomer(customerId: string): Promise<string | null> {
    const conversation = await this.db.conversation.findUnique({ where: { customerId }, select: { id: true } });
    return conversation?.id ?? null;
  }

  async saveTurn(conversationId: string, { state, history, usage }: SaveTurnInput): Promise<void> {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: {
        state: toJson(state),
        history: toJson(history),
        ...(usage
          ? {
              inputTokens: { increment: usage.input },
              outputTokens: { increment: usage.output },
              cacheReadTokens: { increment: usage.cacheRead },
              cacheWriteTokens: { increment: usage.cacheWrite },
            }
          : {}),
      },
    });
  }

  async setMode(conversationId: string, mode: ConversationMode): Promise<void> {
    await this.db.conversation.update({ where: { id: conversationId }, data: { mode } });
  }

  /** Cambia el modo solo si la conversación pertenece al restaurante. Devuelve false si no existe. */
  async setModeForRestaurant(restaurantId: string, conversationId: string, mode: ConversationMode): Promise<boolean> {
    const result = await this.db.conversation.updateMany({ where: { id: conversationId, restaurantId }, data: { mode } });
    return result.count > 0;
  }

  /** Últimos mensajes de la conversación en orden cronológico; null si no pertenece al restaurante. */
  async listMessages(restaurantId: string, conversationId: string): Promise<ConversationMessage[] | null> {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, restaurantId } });
    if (!conversation) return null;
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: TRANSCRIPT_LIMIT,
      select: { id: true, direction: true, type: true, body: true, createdAt: true },
    });
    return rows.reverse();
  }

  async listByMode(restaurantId: string, mode: ConversationMode): Promise<HumanConversationSummary[]> {
    const rows = await this.db.conversation.findMany({
      where: { restaurantId, mode },
      orderBy: { updatedAt: "desc" },
      include: { customer: true },
    });
    return rows.map((row) => ({
      id: row.id,
      customerName: row.customer.name,
      customerPhone: row.customer.phone,
      updatedAt: row.updatedAt,
    }));
  }
}
