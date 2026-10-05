import { describe, expect, it, vi } from "vitest";
import { CloudApiMessenger } from "../../src/whatsapp/cloud-api-messenger.ts";
import { MAX_TEXT_LENGTH } from "../../src/whatsapp/messenger.ts";

function setup(response: Response = new Response("{}", { status: 200 })) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const messenger = new CloudApiMessenger({ accessToken: "TOKEN", apiVersion: "v23.0", fetchFn: fetchMock });
  const sentBodies = (): Record<string, unknown>[] =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  return { fetchMock, messenger, sentBodies };
}

describe("CloudApiMessenger", () => {
  it("sends text messages to the Graph API with the bearer token", async () => {
    const { fetchMock, messenger, sentBodies } = setup();

    await messenger.sendText({ phoneNumberId: "PNID", to: "573001112233", text: "Hola" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://graph.facebook.com/v23.0/PNID/messages");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer TOKEN" });
    expect(sentBodies()[0]).toMatchObject({
      messaging_product: "whatsapp",
      to: "573001112233",
      type: "text",
      text: { body: "Hola", preview_url: false },
    });
  });

  it("splits texts longer than the WhatsApp limit", async () => {
    const { messenger, sentBodies } = setup();
    const longText = `${"a".repeat(MAX_TEXT_LENGTH - 10)}\n${"b".repeat(50)}`;

    await messenger.sendText({ phoneNumberId: "PNID", to: "573", text: longText });

    expect(sentBodies()).toHaveLength(2);
  });

  it("sends reply buttons, trimming titles to 20 characters", async () => {
    const { messenger, sentBodies } = setup();

    await messenger.sendButtons({
      phoneNumberId: "PNID",
      to: "573",
      body: "¿Confirmas?",
      buttons: [
        { id: "confirm_order", title: "Confirmar pedido" },
        { id: "edit_order", title: "Quiero cambiar algo del pedido" },
      ],
    });

    expect(sentBodies()[0]).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "¿Confirmas?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "confirm_order", title: "Confirmar pedido" } },
            { type: "reply", reply: { id: "edit_order", title: "Quiero cambiar algo" } },
          ],
        },
      },
    });
  });

  it("marks messages as read", async () => {
    const { messenger, sentBodies } = setup();

    await messenger.markAsRead({ phoneNumberId: "PNID", messageId: "wamid.1" });

    expect(sentBodies()[0]).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.1" });
  });

  it("throws a descriptive error when the API answers with an error", async () => {
    const { messenger } = setup(new Response('{"error":{"message":"Invalid token"}}', { status: 401 }));

    await expect(messenger.sendText({ phoneNumberId: "PNID", to: "573", text: "Hola" })).rejects.toThrow(/401/);
  });
});
