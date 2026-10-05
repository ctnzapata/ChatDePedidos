import {
  MAX_BUTTON_BODY_LENGTH,
  MAX_BUTTONS,
  clampButtonTitle,
  splitText,
  type MarkAsReadParams,
  type Messenger,
  type SendButtonsParams,
  type SendTextParams,
} from "./messenger.ts";

const GRAPH_BASE_URL = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_LENGTH = 500;

export interface CloudApiMessengerOptions {
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly fetchFn?: typeof fetch;
}

export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`WhatsApp Cloud API respondió ${status}: ${responseBody}`);
    this.name = "WhatsAppApiError";
  }
}

/** Envía mensajes con la WhatsApp Cloud API oficial de Meta. */
export class CloudApiMessenger implements Messenger {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: CloudApiMessengerOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async sendText({ phoneNumberId, to, text }: SendTextParams): Promise<void> {
    for (const chunk of splitText(text)) {
      await this.post(phoneNumberId, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: chunk, preview_url: false },
      });
    }
  }

  async sendButtons({ phoneNumberId, to, body, buttons }: SendButtonsParams): Promise<void> {
    await this.post(phoneNumberId, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, MAX_BUTTON_BODY_LENGTH) },
        action: {
          buttons: buttons
            .slice(0, MAX_BUTTONS)
            .map((b) => ({ type: "reply", reply: { id: b.id, title: clampButtonTitle(b.title) } })),
        },
      },
    });
  }

  async markAsRead({ phoneNumberId, messageId }: MarkAsReadParams): Promise<void> {
    await this.post(phoneNumberId, { messaging_product: "whatsapp", status: "read", message_id: messageId });
  }

  private async post(phoneNumberId: string, payload: Record<string, unknown>): Promise<void> {
    const url = `${GRAPH_BASE_URL}/${this.options.apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
      throw new WhatsAppApiError(response.status, body);
    }
  }
}
