import type {
  MarkAsReadParams,
  Messenger,
  ReplyButton,
  SendButtonsParams,
  SendTextParams,
} from "../../src/whatsapp/messenger.ts";

export type SentMessage =
  | { readonly kind: "text"; readonly to: string; readonly text: string }
  | { readonly kind: "buttons"; readonly to: string; readonly body: string; readonly buttons: readonly ReplyButton[] }
  | { readonly kind: "read"; readonly messageId: string };

/** Messenger en memoria: guarda lo enviado y puede simular fallos por destinatario. */
export class FakeMessenger implements Messenger {
  readonly sent: SentMessage[] = [];
  readonly failingRecipients = new Set<string>();

  async sendText({ to, text }: SendTextParams): Promise<void> {
    this.failIfNeeded(to);
    this.sent.push({ kind: "text", to, text });
  }

  async sendButtons({ to, body, buttons }: SendButtonsParams): Promise<void> {
    this.failIfNeeded(to);
    this.sent.push({ kind: "buttons", to, body, buttons });
  }

  async markAsRead({ messageId }: MarkAsReadParams): Promise<void> {
    this.sent.push({ kind: "read", messageId });
  }

  textsTo(to: string): string[] {
    return this.sent.flatMap((m) => (m.kind === "text" && m.to === to ? [m.text] : []));
  }

  buttonsTo(to: string): Extract<SentMessage, { kind: "buttons" }>[] {
    return this.sent.filter((m): m is Extract<SentMessage, { kind: "buttons" }> => m.kind === "buttons" && m.to === to);
  }

  private failIfNeeded(to: string): void {
    if (this.failingRecipients.has(to)) throw new Error(`Fallo simulado enviando a ${to}`);
  }
}
