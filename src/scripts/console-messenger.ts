import type {
  MarkAsReadParams,
  Messenger,
  SendButtonsParams,
  SendTextParams,
} from "../whatsapp/messenger.ts";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Muestra en la terminal lo que el sistema enviaría por WhatsApp (para el simulador). */
export class ConsoleMessenger implements Messenger {
  constructor(private readonly customerPhone: string) {}

  async sendText({ to, text }: SendTextParams): Promise<void> {
    const who = to === this.customerPhone ? `${GREEN}Asistente${RESET}` : `${YELLOW}Aviso al personal (+${to})${RESET}`;
    process.stdout.write(`\n${who}:\n${text}\n`);
  }

  async sendButtons({ body, buttons }: SendButtonsParams): Promise<void> {
    const options = buttons.map((b) => `[${b.title}]`).join("  ");
    process.stdout.write(`\n${GREEN}Asistente${RESET}:\n${body}\n${options}\n${DIM}(escribe /confirmar o /modificar)${RESET}\n`);
  }

  async markAsRead(_params: MarkAsReadParams): Promise<void> {
    // En consola no hay "visto".
  }
}
