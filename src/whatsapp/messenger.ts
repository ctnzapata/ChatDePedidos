/** Límites de la WhatsApp Cloud API. */
export const MAX_TEXT_LENGTH = 4096;
export const MAX_BUTTON_BODY_LENGTH = 1024;
export const MAX_BUTTON_TITLE_LENGTH = 20;
export const MAX_BUTTONS = 3;

export interface ReplyButton {
  readonly id: string;
  readonly title: string;
}

export interface SendTextParams {
  readonly phoneNumberId: string;
  readonly to: string;
  readonly text: string;
}

export interface SendButtonsParams {
  readonly phoneNumberId: string;
  readonly to: string;
  readonly body: string;
  readonly buttons: readonly ReplyButton[];
}

export interface MarkAsReadParams {
  readonly phoneNumberId: string;
  readonly messageId: string;
}

/** Puerto de salida: WhatsApp real en producción, consola en el simulador, falso en pruebas. */
export interface Messenger {
  sendText(params: SendTextParams): Promise<void>;
  sendButtons(params: SendButtonsParams): Promise<void>;
  markAsRead(params: MarkAsReadParams): Promise<void>;
}

/** Divide un texto largo en trozos que WhatsApp acepta, cortando preferiblemente en saltos de línea. */
export function splitText(text: string, maxLength: number = MAX_TEXT_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > maxLength) {
    const newline = rest.lastIndexOf("\n", maxLength);
    const cut = newline > 0 ? newline : maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export function clampButtonTitle(title: string): string {
  return title.slice(0, MAX_BUTTON_TITLE_LENGTH).trim();
}
