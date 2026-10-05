import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart } from "../../src/domain/cart.ts";
import { buildQuote } from "../../src/domain/checkout.ts";
import { ConversationRepository } from "../../src/repositories/conversation-repository.ts";
import { OrderRepository } from "../../src/repositories/order-repository.ts";
import { RestaurantRepository } from "../../src/repositories/restaurant-repository.ts";
import { PanelService } from "../../src/services/panel-service.ts";
import { CUSTOMER_PHONE, resetDatabase, seedTestStore, testPrisma } from "../fixtures/db.ts";
import { FakeMessenger } from "../fixtures/fake-messenger.ts";

const restaurants = new RestaurantRepository(testPrisma);
const conversations = new ConversationRepository(testPrisma);
const orders = new OrderRepository(testPrisma);

let restaurantId: string;

async function createOrder(fulfillment: "PICKUP" | "DELIVERY" = "PICKUP") {
  const catalog = await restaurants.loadCatalog(restaurantId);
  const store = await restaurants.findById(restaurantId);
  const cart = addToCart(EMPTY_CART, catalog, { itemCode: "HAM-DOB", quantity: 1, modifierCodes: ["EXT-QUE"] });
  if (!cart.ok || !store) throw new Error("setup");
  const quote = buildQuote(
    cart.value,
    catalog,
    { fulfillment, customerName: "Ana", address: "Cra 10 # 20-30", paymentMethod: "TRANSFER" },
    store.policy,
  );
  if (!quote.ok) throw new Error(quote.error.join());
  const conversation = await conversations.getOrCreate(restaurantId, CUSTOMER_PHONE, "Ana");
  return orders.createFromQuote({ restaurantId, customerId: conversation.customerId, quote: quote.value });
}

function setup() {
  const messenger = new FakeMessenger();
  const panel = new PanelService({ restaurants, conversations, orders, messenger });
  return { messenger, panel };
}

beforeEach(async () => {
  await resetDatabase();
  restaurantId = await seedTestStore();
});

describe("PanelService", () => {
  it("lists active orders with items and next statuses", async () => {
    await createOrder();
    const { panel } = setup();

    const [order] = await panel.listOrders(restaurantId);

    expect(order).toMatchObject({
      number: 1,
      status: "PENDING",
      customerPhone: CUSTOMER_PHONE,
      total: 29000,
      nextStatuses: ["ACCEPTED", "REJECTED", "CANCELLED"],
    });
    expect(order?.items[0]).toMatchObject({ name: "Hamburguesa doble", modifiers: ["Queso extra"] });
  });

  it("numbers orders consecutively per restaurant", async () => {
    await createOrder();
    const second = await createOrder();

    expect(second.number).toBe(2);
  });

  it("changes the status and notifies the customer", async () => {
    const created = await createOrder("DELIVERY");
    const { panel, messenger } = setup();

    const result = await panel.updateOrderStatus(restaurantId, created.id, "ACCEPTED");

    expect(result.ok && result.value.status).toBe("ACCEPTED");
    expect(messenger.textsTo(CUSTOMER_PHONE)[0]).toContain("aceptó tu pedido #1");
  });

  it("rejects invalid transitions without notifying", async () => {
    const created = await createOrder("PICKUP");
    const { panel, messenger } = setup();

    const result = await panel.updateOrderStatus(restaurantId, created.id, "OUT_FOR_DELIVERY");

    expect(result.ok).toBe(false);
    expect(messenger.sent).toHaveLength(0);
  });

  it("does not touch orders of another restaurant", async () => {
    const created = await createOrder();
    const { panel } = setup();

    const result = await panel.updateOrderStatus("otro-restaurante", created.id, "ACCEPTED");

    expect(result.ok).toBe(false);
  });

  it("keeps the status change even if the WhatsApp notice fails", async () => {
    const created = await createOrder();
    const { panel, messenger } = setup();
    messenger.failingRecipients.add(CUSTOMER_PHONE);

    const result = await panel.updateOrderStatus(restaurantId, created.id, "ACCEPTED");

    expect(result.ok).toBe(true);
  });

  it("hides finished orders unless asked", async () => {
    const created = await createOrder();
    const { panel } = setup();
    await panel.updateOrderStatus(restaurantId, created.id, "REJECTED");

    expect(await panel.listOrders(restaurantId)).toHaveLength(0);
    expect(await panel.listOrders(restaurantId, { includeClosed: true })).toHaveLength(1);
  });

  it("toggles item availability and pauses orders", async () => {
    const { panel } = setup();

    expect((await panel.setItemAvailability(restaurantId, "HAM-SEN", false)).ok).toBe(true);
    expect((await panel.setItemAvailability(restaurantId, "NOPE", false)).ok).toBe(false);
    await panel.setAcceptingOrders(restaurantId, false);

    const catalog = await restaurants.loadCatalog(restaurantId);
    expect(catalog.items.find((i) => i.code === "HAM-SEN")?.isAvailable).toBe(false);
    expect((await restaurants.findById(restaurantId))?.isAcceptingOrders).toBe(false);
  });

  it("lists conversations waiting for a human and resumes the agent", async () => {
    const conversation = await conversations.getOrCreate(restaurantId, CUSTOMER_PHONE, "Ana");
    await conversations.setMode(conversation.id, "HUMAN");
    const { panel } = setup();

    const waiting = await panel.listHumanConversations(restaurantId);
    const resumed = await panel.resumeAgent(restaurantId, conversation.id);

    expect(waiting).toEqual([expect.objectContaining({ id: conversation.id, customerPhone: CUSTOMER_PHONE })]);
    expect(resumed.ok).toBe(true);
    expect(await panel.listHumanConversations(restaurantId)).toHaveLength(0);
  });
});

describe("OrderRepository.createFromQuote", () => {
  it("assigns unique consecutive numbers to concurrent orders", async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => createOrder()));

    expect(created.map((o) => o.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("OrderRepository.cancelByCustomer", () => {
  it("cancels only pending orders of the same customer", async () => {
    const created = await createOrder();
    const conversation = await conversations.getOrCreate(restaurantId, CUSTOMER_PHONE);
    const { panel } = setup();
    const other = await conversations.getOrCreate(restaurantId, "573000000001");

    expect((await orders.cancelByCustomer(other.customerId, 1)).ok).toBe(false);
    await panel.updateOrderStatus(restaurantId, created.id, "ACCEPTED");
    expect((await orders.cancelByCustomer(conversation.customerId, 1)).ok).toBe(false);
  });
});
