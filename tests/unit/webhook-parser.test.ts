import { describe, expect, it } from "vitest";
import { parseWebhook } from "../../src/whatsapp/webhook-parser.ts";

function envelope(value: Record<string, unknown>): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
  };
}

const metadata = { display_phone_number: "15550000000", phone_number_id: "PNID-1" };
const contacts = [{ wa_id: "573001112233", profile: { name: "Ana" } }];

describe("parseWebhook", () => {
  it("parses a text message", () => {
    const events = parseWebhook(
      envelope({
        metadata,
        contacts,
        messages: [{ from: "573001112233", id: "wamid.1", timestamp: "1759680000", type: "text", text: { body: "Hola" } }],
      }),
    );

    expect(events).toEqual([
      {
        phoneNumberId: "PNID-1",
        from: "573001112233",
        waMessageId: "wamid.1",
        timestamp: new Date(1759680000 * 1000),
        profileName: "Ana",
        content: { kind: "text", text: "Hola" },
      },
    ]);
  });

  it("parses an interactive button reply", () => {
    const [event] = parseWebhook(
      envelope({
        metadata,
        contacts,
        messages: [
          {
            from: "573001112233",
            id: "wamid.2",
            timestamp: "1759680000",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "confirm_order", title: "Confirmar" } },
          },
        ],
      }),
    );

    expect(event?.content).toEqual({ kind: "button", buttonId: "confirm_order", title: "Confirmar" });
  });

  it("marks other message types as unsupported", () => {
    const [event] = parseWebhook(
      envelope({
        metadata,
        messages: [{ from: "573001112233", id: "wamid.3", timestamp: "1759680000", type: "audio", audio: { id: "x" } }],
      }),
    );

    expect(event?.content).toEqual({ kind: "unsupported", type: "audio" });
    expect(event?.profileName).toBeUndefined();
  });

  it("ignores status updates", () => {
    const events = parseWebhook(
      envelope({ metadata, statuses: [{ id: "wamid.1", status: "delivered", recipient_id: "573001112233" }] }),
    );

    expect(events).toEqual([]);
  });

  it.each([null, "texto", {}, { object: "page", entry: [] }])("returns nothing for invalid payloads (%#)", (payload) => {
    expect(parseWebhook(payload)).toEqual([]);
  });
});
