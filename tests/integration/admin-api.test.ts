import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SupabaseAuthVerifier } from "../../src/auth/auth-verifier.ts";
import { SupabaseUserAdmin } from "../../src/auth/user-admin.ts";
import { readSeedFile, seedRestaurant } from "../../src/db/seed-menu.ts";
import { buildServer, type AppServer } from "../../src/http/server.ts";
import { ConversationRepository } from "../../src/repositories/conversation-repository.ts";
import { OrderRepository } from "../../src/repositories/order-repository.ts";
import { RestaurantRepository } from "../../src/repositories/restaurant-repository.ts";
import { StaffRepository } from "../../src/repositories/staff-repository.ts";
import { MetricsService } from "../../src/services/metrics-service.ts";
import { PanelService } from "../../src/services/panel-service.ts";
import { TeamService } from "../../src/services/team-service.ts";
import { resetDatabase, seedTestStore, testPrisma } from "../fixtures/db.ts";
import { FakeMessenger } from "../fixtures/fake-messenger.ts";
import { deleteTestAuthUsers } from "../fixtures/rls.ts";
import {
  createUserWithSession,
  testSupabaseKeys,
  TEST_EMAIL_DOMAIN,
  type TestSession,
} from "../fixtures/supabase-auth.ts";
import { TEST_SUPABASE_URL } from "../test-database.ts";

type Who = "owner" | "staff" | "courier" | "otherCourier" | "outsider";

const restaurants = new RestaurantRepository(testPrisma);
const conversations = new ConversationRepository(testPrisma);
const orders = new OrderRepository(testPrisma);
const staff = new StaffRepository(testPrisma);

let sessions: Record<Who, TestSession>;
let server: AppServer;
let restaurantA: string;
let restaurantB: string;
let staffIds: Record<"courier" | "otherCourier" | "staff", string>;
let deliveryOrderId: string;
let messenger: FakeMessenger;

beforeAll(async () => {
  await deleteTestAuthUsers();
  sessions = {
    owner: await createUserWithSession("owner"),
    staff: await createUserWithSession("staff"),
    courier: await createUserWithSession("courier"),
    otherCourier: await createUserWithSession("courier2"),
    outsider: await createUserWithSession("outsider"),
  };
}, 60_000);

async function addMember(who: Who, restaurantId: string, role: "OWNER" | "STAFF" | "COURIER"): Promise<string> {
  const member = await staff.addOrReactivate({ userId: sessions[who].userId, restaurantId, role, displayName: who });
  return member.staffId;
}

async function addOrder(restaurantId: string, phone: string, number: number, status: "PREPARING" | "PENDING"): Promise<string> {
  const customer = await testPrisma.customer.create({ data: { restaurantId, phone, name: "Ana" } });
  const conversation = await testPrisma.conversation.create({ data: { restaurantId, customerId: customer.id, mode: "HUMAN" } });
  await testPrisma.message.create({ data: { conversationId: conversation.id, direction: "IN", type: "text", body: "Quiero hablar con alguien" } });
  const order = await testPrisma.order.create({
    data: {
      restaurantId,
      customerId: customer.id,
      number,
      status,
      fulfillment: "DELIVERY",
      address: "Cra 10 # 20-30",
      customerName: "Ana",
      paymentMethod: "CASH",
      cashAmount: 50000,
      subtotal: 26000,
      deliveryFee: 5000,
      total: 31000,
      items: { create: [{ itemCode: "HAM-DOB", name: "Hamburguesa doble", unitPrice: 26000, quantity: 1, modifiers: [], lineTotal: 26000 }] },
    },
  });
  return order.id;
}

beforeEach(async () => {
  await resetDatabase();
  restaurantA = await seedTestStore();
  const seed = readSeedFile("seed/menu.json");
  restaurantB = await seedRestaurant(
    testPrisma,
    { ...seed, restaurant: { ...seed.restaurant, slug: "otro-local", name: "Otro Local" } },
    { whatsappPhoneNumberId: "PNID-B", staffPhone: null },
  );
  await addMember("owner", restaurantA, "OWNER");
  staffIds = {
    staff: await addMember("staff", restaurantA, "STAFF"),
    courier: await addMember("courier", restaurantA, "COURIER"),
    otherCourier: await addMember("otherCourier", restaurantA, "COURIER"),
  };
  deliveryOrderId = await addOrder(restaurantA, "573001112233", 1, "PREPARING");
  await addOrder(restaurantB, "573009990000", 1, "PENDING");

  messenger = new FakeMessenger();
  const panel = new PanelService({ restaurants, conversations, orders, messenger });
  server = await buildServer({
    config: { whatsappAppSecret: "s", whatsappVerifyToken: "verify-token-123", panelUser: "admin", panelPassword: "clave-del-panel" },
    processor: { handle: async () => undefined },
    panel,
    restaurants,
    admin: {
      verifier: SupabaseAuthVerifier.create(TEST_SUPABASE_URL, testSupabaseKeys().publishableKey),
      staff,
      panel,
      restaurants,
      team: new TeamService({
        staff,
        userAdmin: SupabaseUserAdmin.create(TEST_SUPABASE_URL, testSupabaseKeys().secretKey, testPrisma),
        inviteRedirectUrl: "http://localhost:3000/admin",
      }),
      metrics: new MetricsService(orders, restaurants),
    },
  });
});

afterEach(async () => {
  await server.close();
});

function call(who: Who | null, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
  return server.inject({
    method,
    url: `/api/admin${url}`,
    headers: who ? { authorization: `Bearer ${sessions[who].accessToken}` } : {},
    ...(payload ? { payload } : {}),
  });
}

describe("autenticación", () => {
  it("rejects requests without a token", async () => {
    expect((await call(null, "GET", "/me")).statusCode).toBe(401);
  });

  it("rejects invalid tokens", async () => {
    const response = await server.inject({ method: "GET", url: "/api/admin/me", headers: { authorization: "Bearer no-es-un-jwt" } });

    expect(response.statusCode).toBe(401);
  });

  it("returns the user's memberships with role and permissions", async () => {
    const response = await call("staff", "GET", "/me");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      userId: sessions.staff.userId,
      memberships: [{ restaurantId: restaurantA, restaurantName: "La Esquina Rápida", role: "STAFF", roleLabel: "Personal" }],
    });
    expect(response.json().data.memberships[0].permissions).toContain("orders:manage");
  });

  it("returns no memberships for users without a restaurant", async () => {
    expect((await call("outsider", "GET", "/me")).json().data.memberships).toEqual([]);
  });
});

describe("pedidos", () => {
  it("lets staff list their restaurant's orders", async () => {
    const response = await call("staff", "GET", `/restaurants/${restaurantA}/orders`);

    expect(response.json().data).toEqual([expect.objectContaining({ id: deliveryOrderId, number: 1, assignedCourier: null })]);
  });

  it("hides other restaurants (404) and blocks couriers from the order board (403)", async () => {
    expect((await call("staff", "GET", `/restaurants/${restaurantB}/orders`)).statusCode).toBe(404);
    expect((await call("courier", "GET", `/restaurants/${restaurantA}/orders`)).statusCode).toBe(403);
  });

  it("requires a courier to dispatch a delivery order", async () => {
    const response = await call("staff", "POST", `/restaurants/${restaurantA}/orders/${deliveryOrderId}/status`, {
      status: "OUT_FOR_DELIVERY",
    });

    expect(response.statusCode).toBe(422);
  });

  it("rejects assigning someone who is not an active courier", async () => {
    const response = await call("staff", "POST", `/restaurants/${restaurantA}/orders/${deliveryOrderId}/status`, {
      status: "OUT_FOR_DELIVERY",
      courierId: staffIds.staff,
    });

    expect(response.statusCode).toBe(422);
  });

  it("dispatches with a courier and notifies the customer", async () => {
    const response = await call("staff", "POST", `/restaurants/${restaurantA}/orders/${deliveryOrderId}/status`, {
      status: "OUT_FOR_DELIVERY",
      courierId: staffIds.courier,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      assignedCourier: { staffId: staffIds.courier, displayName: "courier" },
    });
    expect(messenger.textsTo("573001112233")[0]).toContain("va en camino");
  });

  it("lists active couriers for assignment", async () => {
    const response = await call("staff", "GET", `/restaurants/${restaurantA}/couriers`);

    expect(response.json().data.map((c: { staffId: string }) => c.staffId).sort()).toEqual(
      [staffIds.courier, staffIds.otherCourier].sort(),
    );
  });
});

describe("domiciliario", () => {
  async function dispatch(): Promise<void> {
    await call("staff", "POST", `/restaurants/${restaurantA}/orders/${deliveryOrderId}/status`, {
      status: "OUT_FOR_DELIVERY",
      courierId: staffIds.courier,
    });
  }

  it("sees only the deliveries assigned to them, with cash to collect", async () => {
    await dispatch();

    const mine = await call("courier", "GET", `/restaurants/${restaurantA}/deliveries`);
    const other = await call("otherCourier", "GET", `/restaurants/${restaurantA}/deliveries`);

    expect(mine.json().data).toEqual([expect.objectContaining({ id: deliveryOrderId, total: 31000, cashAmount: 50000 })]);
    expect(other.json().data).toEqual([]);
  });

  it("marks their own delivery as delivered, but not someone else's", async () => {
    await dispatch();

    const notMine = await call("otherCourier", "POST", `/restaurants/${restaurantA}/deliveries/${deliveryOrderId}/delivered`);
    const mine = await call("courier", "POST", `/restaurants/${restaurantA}/deliveries/${deliveryOrderId}/delivered`);

    expect(notMine.statusCode).toBe(404);
    expect(mine.json().data).toMatchObject({ status: "DELIVERED" });
  });

  it("cannot pause orders or see the team", async () => {
    expect((await call("courier", "POST", `/restaurants/${restaurantA}/accepting`, { isAcceptingOrders: false })).statusCode).toBe(403);
    expect((await call("courier", "GET", `/restaurants/${restaurantA}/team`)).statusCode).toBe(403);
  });
});

describe("operación diaria", () => {
  it("lets staff pause orders and mark items as sold out", async () => {
    const pause = await call("staff", "POST", `/restaurants/${restaurantA}/accepting`, { isAcceptingOrders: false });
    const soldOut = await call("staff", "POST", `/restaurants/${restaurantA}/availability`, { code: "HAM-SEN", isAvailable: false });

    expect(pause.statusCode).toBe(200);
    expect(soldOut.statusCode).toBe(200);
    expect((await restaurants.findById(restaurantA))?.isAcceptingOrders).toBe(false);
  });

  it("shows conversations waiting for a human with their messages, and resumes the agent", async () => {
    const waiting = await call("staff", "GET", `/restaurants/${restaurantA}/conversations/human`);
    const conversationId = waiting.json().data[0].id as string;

    const messages = await call("staff", "GET", `/restaurants/${restaurantA}/conversations/${conversationId}/messages`);
    const resume = await call("staff", "POST", `/restaurants/${restaurantA}/conversations/${conversationId}/resume`);

    expect(messages.json().data).toEqual([expect.objectContaining({ direction: "IN", body: "Quiero hablar con alguien" })]);
    expect(resume.statusCode).toBe(200);
  });
});

describe("equipo (solo dueño)", () => {
  it("lists the team with emails and blocks staff from it", async () => {
    const team = await call("owner", "GET", `/restaurants/${restaurantA}/team`);

    expect(team.json().data).toHaveLength(4);
    expect(team.json().data).toContainEqual(expect.objectContaining({ email: sessions.courier.email, role: "COURIER" }));
    expect((await call("staff", "GET", `/restaurants/${restaurantA}/team`)).statusCode).toBe(403);
  });

  it("invites a new person by email as courier", async () => {
    const email = `nuevo-${Date.now()}@${TEST_EMAIL_DOMAIN}`;

    const response = await call("owner", "POST", `/restaurants/${restaurantA}/team/invite`, {
      email,
      displayName: "Juan",
      role: "COURIER",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ email, role: "COURIER", displayName: "Juan", isActive: true });
  });

  it("adds an existing user without sending a new invitation", async () => {
    const response = await call("owner", "POST", `/restaurants/${restaurantA}/team/invite`, {
      email: sessions.outsider.email,
      displayName: "Laura",
      role: "STAFF",
    });

    expect(response.json().data).toMatchObject({ userId: sessions.outsider.userId, role: "STAFF" });
  });

  it("changes roles and deactivates members, but never leaves the restaurant without an owner", async () => {
    const promote = await call("owner", "PATCH", `/restaurants/${restaurantA}/team/${staffIds.staff}`, { role: "OWNER" });
    const deactivate = await call("owner", "PATCH", `/restaurants/${restaurantA}/team/${staffIds.courier}`, { isActive: false });
    const ownerMember = (await call("owner", "GET", `/restaurants/${restaurantA}/team`)).json().data.find(
      (m: { userId: string }) => m.userId === sessions.owner.userId,
    );
    await call("owner", "PATCH", `/restaurants/${restaurantA}/team/${staffIds.staff}`, { role: "STAFF" });
    const lastOwner = await call("owner", "PATCH", `/restaurants/${restaurantA}/team/${ownerMember.staffId}`, { isActive: false });

    expect(promote.json().data).toMatchObject({ role: "OWNER" });
    expect(deactivate.json().data).toMatchObject({ isActive: false });
    expect(lastOwner.statusCode).toBe(409);
  });
});

describe("métricas (solo dueño)", () => {
  it("summarizes today's orders", async () => {
    const response = await call("owner", "GET", `/restaurants/${restaurantA}/metrics/today`);

    expect(response.json().data).toMatchObject({ ordersCount: 1, revenue: 31000, activeCount: 1 });
    expect((await call("staff", "GET", `/restaurants/${restaurantA}/metrics/today`)).statusCode).toBe(403);
  });
});

describe("validación", () => {
  it("rejects malformed ids and bodies with 400", async () => {
    expect((await call("owner", "GET", "/restaurants/nope/orders")).statusCode).toBe(400);
    expect((await call("owner", "POST", `/restaurants/${restaurantA}/team/invite`, { email: "no-es-email", role: "OWNER", displayName: "x" })).statusCode).toBe(400);
  });
});
