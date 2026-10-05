import { z } from "zod";

export type InboundContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "button"; readonly buttonId: string; readonly title: string }
  | { readonly kind: "unsupported"; readonly type: string };

export interface InboundMessage {
  readonly phoneNumberId: string;
  readonly from: string;
  readonly waMessageId: string;
  readonly timestamp: Date;
  readonly profileName?: string;
  readonly content: InboundContent;
}

const replySchema = z.object({ id: z.string(), title: z.string() });

const messageSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .object({ type: z.string(), button_reply: replySchema.optional(), list_reply: replySchema.optional() })
    .optional(),
  // Respuesta a un botón de una plantilla (quick reply).
  button: z.object({ payload: z.string(), text: z.string() }).optional(),
});

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1) }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
  messages: z.array(messageSchema).optional(),
});

const envelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() })) })),
});

type RawMessage = z.infer<typeof messageSchema>;

function toContent(message: RawMessage): InboundContent {
  if (message.type === "text" && message.text) return { kind: "text", text: message.text.body };
  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (message.type === "interactive" && reply) return { kind: "button", buttonId: reply.id, title: reply.title };
  if (message.type === "button" && message.button) {
    return { kind: "button", buttonId: message.button.payload, title: message.button.text };
  }
  return { kind: "unsupported", type: message.type };
}

/**
 * Extrae los mensajes entrantes de un webhook de WhatsApp Cloud API.
 * Ignora notificaciones de estado (sent/delivered/read) y payloads que no reconoce.
 */
export function parseWebhook(payload: unknown): InboundMessage[] {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return [];

  const messages: InboundMessage[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success || !value.data.messages) continue;

      const { metadata, contacts = [] } = value.data;
      for (const message of value.data.messages) {
        const profileName = contacts.find((c) => c.wa_id === message.from)?.profile?.name;
        messages.push({
          phoneNumberId: metadata.phone_number_id,
          from: message.from,
          waMessageId: message.id,
          timestamp: new Date(Number(message.timestamp) * 1000),
          ...(profileName ? { profileName } : {}),
          content: toContent(message),
        });
      }
    }
  }
  return messages;
}
