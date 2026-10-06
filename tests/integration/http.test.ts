import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart } from "../../src/domain/cart.ts";
import { buildQuote } from "../../src/domain/checkout.ts";
import { buildServer, type AppServer } from "../../src/http/server.ts";
import { ConversationRepository } from "../../src/repositories/conversation-repository.ts";
import { OrderRepository } from "../../src/repositories/order-repository.ts";
import { RestaurantRepository } from "../../src/repositories/restaurant-repository.ts";
import { PanelService } from "../../src/services/panel-service.ts";
import type { InboundMessage } from "../../src/whatsapp/webhook-parser.ts";
import { CUSTOMER_PHONE, TEST_PHONE_NUMBER_ID, resetDatabase, seedTestStore, testPrisma } from "../fixtures/db.ts";
import { FakeMessenger } from "../fixtures/fake-messenger.ts";

const APP_SECRET = "app-secret";
const VERIFY_TOKEN = "verify-token-123";
const PANEL_USER = "admin";
const PANEL_PASSWORD = "clave-del-panel";
const AUTH = `Basic ${Buffer.from(`${PANEL_USER}:${PANEL_PASSWORD}`).toString("base64")}`;
const PANEL_HEADERS = { authorization: AUTH, "x-requested-with": "panel" };

const restaurants = new RestaurantRepository(testPrisma);
const conversations = new ConversationRepository(testPrisma);
const orders = new OrderRepository(testPrisma);

let server: AppServer;
let handled: InboundMessage[];
let restaurantId: string;

const sign = (body: string): string => `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

const webhookBody = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: TEST_PHONE_NUMBER_ID },
            messages: [{ from: CUSTOMER_PHONE, id: "wamid.http", timestamp: "1759680000", type: "text", text: { body: "Hola" } }],
          },
        },
      ],
    },
  ],
});

async function createOrder(): Promise<string> {
  const catalog = await restaurants.loadCatalog(restaurantId);
  const store = await restaurants.findById(restaurantId);
  const cart = addToCart(EMPTY_CART, catalog, { itemCode: "HAM-SEN", quantity: 1, modifierCodes: [] });
  if (!cart.ok || !store) throw new Error("setup");
  const quote = buildQuote(cart.value, catalog, { fulfillment: "PICKUP", customerName: "Ana", paymentMethod: "CASH" }, store.policy);
  if (!quote.ok) throw new Error("setup");
  const conversation = await conversations.getOrCreate(restaurantId, CUSTOMER_PHONE);
  return (await orders.createFromQuote({ restaurantId, customerId: conversation.customerId, quote: quote.value })).id;
}

beforeEach(async () => {
  await resetDatabase();
  restaurantId = await seedTestStore();
  handled = [];
  server = await buildServer({
    config: {
      whatsappAppSecret: APP_SECRET,
      whatsappVerifyToken: VERIFY_TOKEN,
      panelUser: PANEL_USER,
      panelPassword: PANEL_PASSWORD,
    },
    processor: {
      handle: async (message) => {
        handled.push(message);
      },
    },
    panel: new PanelService({ restaurants, conversations, orders, messenger: new FakeMessenger() }),
    restaurants,
  });
});

afterEach(async () => {
  await server.close();
});

describe("health", () => {
  it("answers ok", async () => {
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.json()).toEqual({ ok: true });
  });
});

describe("webhook", () => {
  it("answers Meta's verification challenge", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("12345");
  });

  it("rejects verification with the wrong token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345",
    });

    expect(response.statusCode).toBe(403);
  });

  it("accepts signed notifications and hands messages to the processor", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/webhook",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(webhookBody) },
      payload: webhookBody,
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handled).toEqual([expect.objectContaining({ waMessageId: "wamid.http", from: CUSTOMER_PHONE })]);
  });

  it("rejects notifications with an invalid signature", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/webhook",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign("otro") },
      payload: webhookBody,
    });

    expect(response.statusCode).toBe(401);
    expect(handled).toHaveLength(0);
  });
});

describe("panel", () => {
  it("asks for credentials", async () => {
    const response = await server.inject({ method: "GET", url: "/panel" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Basic");
  });

  it("rejects wrong credentials", async () => {
    const wrong = `Basic ${Buffer.from("admin:otra").toString("base64")}`;

    const response = await server.inject({ method: "GET", url: "/panel", headers: { authorization: wrong } });

    expect(response.statusCode).toBe(401);
  });

  it("serves the panel page and its script with security headers", async () => {
    const page = await server.inject({ method: "GET", url: "/panel", headers: { authorization: AUTH } });
    const script = await server.inject({ method: "GET", url: "/panel/app.js", headers: { authorization: AUTH } });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(script.headers["content-type"]).toContain("javascript");
  });

  it("lists restaurants and orders", async () => {
    await createOrder();

    const list = await server.inject({ method: "GET", url: "/panel/api/restaurants", headers: PANEL_HEADERS });
    const orderList = await server.inject({
      method: "GET",
      url: `/panel/api/restaurants/${restaurantId}/orders`,
      headers: PANEL_HEADERS,
    });

    expect(list.json()).toMatchObject({ success: true, data: [{ id: restaurantId, name: "La Esquina Rápida" }] });
    expect(orderList.json()).toMatchObject({ success: true, data: [{ number: 1, status: "PENDING" }] });
  });

  it("changes an order status", async () => {
    const orderId = await createOrder();

    const response = await server.inject({
      method: "POST",
      url: `/panel/api/restaurants/${restaurantId}/orders/${orderId}/status`,
      headers: PANEL_HEADERS,
      payload: { status: "ACCEPTED" },
    });

    expect(response.json()).toMatchObject({ success: true, data: { status: "ACCEPTED" } });
  });

  it("returns 409 for invalid transitions and 400 for invalid bodies", async () => {
    const orderId = await createOrder();
    const url = `/panel/api/restaurants/${restaurantId}/orders/${orderId}/status`;

    const invalidTransition = await server.inject({ method: "POST", url, headers: PANEL_HEADERS, payload: { status: "DELIVERED" } });
    const invalidBody = await server.inject({ method: "POST", url, headers: PANEL_HEADERS, payload: { status: "VOLANDO" } });

    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({ success: false, error: expect.any(String) });
    expect(invalidBody.statusCode).toBe(400);
  });

  it("requires the anti-CSRF header on state-changing requests", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/panel/api/restaurants/${restaurantId}/accepting`,
      headers: { authorization: AUTH },
      payload: { isAcceptingOrders: false },
    });

    expect(response.statusCode).toBe(403);
  });

  it("pauses orders and marks items as sold out", async () => {
    const pause = await server.inject({
      method: "POST",
      url: `/panel/api/restaurants/${restaurantId}/accepting`,
      headers: PANEL_HEADERS,
      payload: { isAcceptingOrders: false },
    });
    const soldOut = await server.inject({
      method: "POST",
      url: `/panel/api/restaurants/${restaurantId}/availability`,
      headers: PANEL_HEADERS,
      payload: { code: "HAM-SEN", isAvailable: false },
    });
    const menu = await server.inject({ method: "GET", url: `/panel/api/restaurants/${restaurantId}/menu`, headers: PANEL_HEADERS });

    expect(pause.json()).toMatchObject({ success: true });
    expect(soldOut.json()).toMatchObject({ success: true });
    const items = menu.json().data.items as { code: string; isAvailable: boolean }[];
    expect(items.find((i) => i.code === "HAM-SEN")?.isAvailable).toBe(false);
  });

  it("lists conversations waiting for a human and resumes the agent", async () => {
    const conversation = await conversations.getOrCreate(restaurantId, CUSTOMER_PHONE, "Ana");
    await conversations.setMode(conversation.id, "HUMAN");

    const waiting = await server.inject({
      method: "GET",
      url: `/panel/api/restaurants/${restaurantId}/conversations/human`,
      headers: PANEL_HEADERS,
    });
    const resume = await server.inject({
      method: "POST",
      url: `/panel/api/restaurants/${restaurantId}/conversations/${conversation.id}/resume`,
      headers: PANEL_HEADERS,
      payload: {},
    });

    expect(waiting.json().data).toHaveLength(1);
    expect(resume.json()).toMatchObject({ success: true });
  });

  it("returns 404 for unknown restaurants", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/panel/api/restaurants/${randomUUID()}/orders`,
      headers: PANEL_HEADERS,
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects malformed ids with 400 before querying the database", async () => {
    const response = await server.inject({ method: "GET", url: "/panel/api/restaurants/nope/orders", headers: PANEL_HEADERS });

    expect(response.statusCode).toBe(400);
  });
});
