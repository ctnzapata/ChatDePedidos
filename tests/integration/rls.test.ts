import { beforeEach, describe, expect, it } from "vitest";
import { readSeedFile, seedRestaurant } from "../../src/db/seed-menu.ts";
import { resetDatabase, seedTestStore, testPrisma } from "../fixtures/db.ts";
import { asUser, createAuthUser, deleteTestAuthUsers, visibleIds } from "../fixtures/rls.ts";

type Role = "OWNER" | "STAFF" | "COURIER";

interface World {
  readonly restaurantA: string;
  readonly restaurantB: string;
  readonly users: Record<"ownerA" | "staffA" | "courierA" | "otherCourierA" | "inactiveA" | "ownerB" | "outsider", string>;
  readonly orders: Record<"assignedToCourierA" | "unassignedA" | "fromB", string>;
}

async function addStaff(userId: string, restaurantId: string, role: Role, isActive = true): Promise<string> {
  const member = await testPrisma.staffMember.create({
    data: { userId, restaurantId, role, displayName: role.toLowerCase(), isActive },
  });
  return member.id;
}

/** Crea cliente, conversación, mensaje y un pedido con un ítem. */
async function addOrder(restaurantId: string, phone: string, number: number, assignedCourierId?: string): Promise<string> {
  const customer = await testPrisma.customer.create({ data: { restaurantId, phone } });
  const conversation = await testPrisma.conversation.create({ data: { restaurantId, customerId: customer.id } });
  await testPrisma.message.create({ data: { conversationId: conversation.id, direction: "IN", type: "text", body: "Hola" } });
  const order = await testPrisma.order.create({
    data: {
      restaurantId,
      customerId: customer.id,
      number,
      status: assignedCourierId ? "OUT_FOR_DELIVERY" : "PENDING",
      fulfillment: "DELIVERY",
      address: "Calle 1 # 2-3",
      customerName: "Cliente",
      paymentMethod: "CASH",
      subtotal: 20000,
      deliveryFee: 5000,
      total: 25000,
      assignedCourierId: assignedCourierId ?? null,
      items: {
        create: [{ itemCode: "HAM-SEN", name: "Hamburguesa", unitPrice: 20000, quantity: 1, modifiers: [], lineTotal: 20000 }],
      },
    },
  });
  return order.id;
}

async function buildWorld(): Promise<World> {
  const restaurantA = await seedTestStore();
  const seed = readSeedFile("seed/menu.json");
  const restaurantB = await seedRestaurant(
    testPrisma,
    { ...seed, restaurant: { ...seed.restaurant, slug: "otro-local", name: "Otro Local" } },
    { whatsappPhoneNumberId: "PNID-B", staffPhone: null },
  );

  const users = {
    ownerA: await createAuthUser("owner-a"),
    staffA: await createAuthUser("staff-a"),
    courierA: await createAuthUser("courier-a"),
    otherCourierA: await createAuthUser("courier2-a"),
    inactiveA: await createAuthUser("inactive-a"),
    ownerB: await createAuthUser("owner-b"),
    outsider: await createAuthUser("outsider"),
  };
  await addStaff(users.ownerA, restaurantA, "OWNER");
  await addStaff(users.staffA, restaurantA, "STAFF");
  const courierAStaffId = await addStaff(users.courierA, restaurantA, "COURIER");
  await addStaff(users.otherCourierA, restaurantA, "COURIER");
  await addStaff(users.inactiveA, restaurantA, "OWNER", false);
  await addStaff(users.ownerB, restaurantB, "OWNER");

  const orders = {
    assignedToCourierA: await addOrder(restaurantA, "573000000001", 1, courierAStaffId),
    unassignedA: await addOrder(restaurantA, "573000000002", 2),
    fromB: await addOrder(restaurantB, "573000000003", 1),
  };
  return { restaurantA, restaurantB, users, orders };
}

let world: World;

beforeEach(async () => {
  await resetDatabase();
  await deleteTestAuthUsers();
  world = await buildWorld();
});

const sorted = (...ids: string[]): string[] => [...ids].sort();

describe("RLS: sin sesión (llave pública)", () => {
  it.each(["restaurants", "orders", "customers", "menu_items"] as const)("cannot read %s at all", async (table) => {
    await expect(visibleIds(null, table)).rejects.toThrow(/permission denied/i);
  });
});

describe("RLS: dueño y personal", () => {
  it("the owner sees only their restaurant and its orders", async () => {
    const { ownerA } = world.users;

    expect(await visibleIds(ownerA, "restaurants")).toEqual([world.restaurantA]);
    expect(await visibleIds(ownerA, "orders")).toEqual(sorted(world.orders.assignedToCourierA, world.orders.unassignedA));
  });

  it("staff sees the same back-office data as the owner", async () => {
    const { ownerA, staffA } = world.users;

    for (const table of ["orders", "customers", "conversations", "messages", "menu_items", "order_items"] as const) {
      expect(await visibleIds(staffA, table)).toEqual(await visibleIds(ownerA, table));
    }
  });

  it("back office sees customers, conversations, messages and menu only of their restaurant", async () => {
    const { ownerA } = world.users;
    const menuA = await testPrisma.menuItem.count({ where: { restaurantId: world.restaurantA } });

    expect(await visibleIds(ownerA, "customers")).toHaveLength(2);
    expect(await visibleIds(ownerA, "conversations")).toHaveLength(2);
    expect(await visibleIds(ownerA, "messages")).toHaveLength(2);
    expect(await visibleIds(ownerA, "menu_items")).toHaveLength(menuA);
  });

  it("the owner sees the whole team, but not other restaurants' staff", async () => {
    const team = await visibleIds(world.users.ownerA, "staff_members");

    expect(team).toHaveLength(5);
  });

  it("an owner of another restaurant cannot see restaurant A", async () => {
    const { ownerB } = world.users;

    expect(await visibleIds(ownerB, "restaurants")).toEqual([world.restaurantB]);
    expect(await visibleIds(ownerB, "orders")).toEqual([world.orders.fromB]);
  });
});

describe("RLS: domiciliario", () => {
  it("sees only the orders assigned to them, with their items", async () => {
    const { courierA } = world.users;
    const items = await asUser(courierA, (tx) => tx.$queryRaw<{ order_id: string }[]>`select order_id::text from order_items`);

    expect(await visibleIds(courierA, "orders")).toEqual([world.orders.assignedToCourierA]);
    expect(items.map((i) => i.order_id)).toEqual([world.orders.assignedToCourierA]);
  });

  it("cannot see customers, conversations, messages, menu or other staff", async () => {
    const { courierA } = world.users;

    for (const table of ["customers", "conversations", "messages", "menu_items", "menu_modifiers"] as const) {
      expect(await visibleIds(courierA, table)).toEqual([]);
    }
    const ownRows = await asUser(courierA, (tx) => tx.$queryRaw<{ user_id: string }[]>`select user_id::text from staff_members`);
    expect(ownRows.map((r) => r.user_id)).toEqual([courierA]);
  });

  it("another courier without assignments sees no orders", async () => {
    expect(await visibleIds(world.users.otherCourierA, "orders")).toEqual([]);
  });
});

describe("RLS: usuarios sin acceso", () => {
  it("a logged-in user without membership sees nothing", async () => {
    for (const table of ["restaurants", "orders", "customers", "staff_members"] as const) {
      expect(await visibleIds(world.users.outsider, table)).toEqual([]);
    }
  });

  it("an inactive member sees nothing", async () => {
    expect(await visibleIds(world.users.inactiveA, "orders")).toEqual([]);
    expect(await visibleIds(world.users.inactiveA, "restaurants")).toEqual([]);
  });
});

describe("RLS: escrituras directas bloqueadas", () => {
  it("the owner cannot change an order directly (must use the API)", async () => {
    const attempt = asUser(world.users.ownerA, (tx) =>
      tx.$executeRaw`update orders set total = 0 where id = ${world.orders.unassignedA}::uuid`,
    );

    await expect(attempt).rejects.toThrow(/permission denied/i);
  });

  it("a courier cannot promote themselves to owner", async () => {
    const attempt = asUser(world.users.courierA, (tx) =>
      tx.$executeRaw`insert into staff_members (id, user_id, restaurant_id, role, display_name)
        values (gen_random_uuid(), ${world.users.courierA}::uuid, ${world.restaurantA}::uuid, 'OWNER', 'yo')`,
    );

    await expect(attempt).rejects.toThrow(/permission denied/i);
  });

  it("nobody can delete data directly", async () => {
    const attempt = asUser(world.users.ownerA, (tx) => tx.$executeRaw`delete from customers`);

    await expect(attempt).rejects.toThrow(/permission denied/i);
  });
});

describe("RLS: cobertura del esquema", () => {
  it("every table in the public schema has RLS enabled", async () => {
    const unprotected = await testPrisma.$queryRaw<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' and not rowsecurity`;

    expect(unprotected).toEqual([]);
  });
});
