import type { StorePolicy } from "./checkout.ts";
import type { OpeningWindow } from "./hours.ts";

/** Datos del restaurante que necesitan el agente, los mensajes y el panel. */
export interface StoreProfile {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly whatsappPhoneNumberId: string;
  readonly staffPhone: string | null;
  readonly address: string;
  readonly timezone: string;
  readonly openingHours: readonly OpeningWindow[];
  readonly policy: StorePolicy;
  readonly prepTimeMinutes: number;
  readonly deliveryTimeMinutes: number;
  readonly transferInfo: string | null;
  readonly isAcceptingOrders: boolean;
}
