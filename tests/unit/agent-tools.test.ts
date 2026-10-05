import { describe, expect, it, vi } from "vitest";
import { INITIAL_AGENT_STATE, type AgentState } from "../../src/agent/agent-state.ts";
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from "../../src/agent/tools.ts";
import { err, ok } from "../../src/lib/result.ts";
import { catalog, policy } from "../fixtures/catalog.ts";

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    catalog,
    policy,
    isOpen: true,
    isAcceptingOrders: true,
    openingHoursText: "Todos los días de 11:00 a 22:00",
    orders: {
      listRecent: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue(err("No existe")),
    },
    ...overrides,
  };
}

async function run(name: string, input: unknown, state: AgentState = INITIAL_AGENT_STATE, ctx = context()) {
  return executeTool(name, input, state, ctx);
}

const readyState = async (): Promise<AgentState> => {
  const added = await run("add_to_cart", { item_code: "HAM-SEN", quantity: 1 });
  const detailed = await run(
    "set_order_details",
    { fulfillment: "PICKUP", customer_name: "Ana", payment_method: "CASH", cash_amount: 50000 },
    added.state,
  );
  return detailed.state;
};

describe("TOOL_DEFINITIONS", () => {
  it("exposes JSON schemas without the $schema key and with unique names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);

    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).not.toHaveProperty("$schema");
      expect(tool.description?.length).toBeGreaterThan(20);
    }
  });
});

describe("executeTool", () => {
  it("adds items to the cart and returns the priced cart", async () => {
    const outcome = await run("add_to_cart", { item_code: "HAM-SEN", quantity: 2, extra_codes: ["EXT-QUE"] });

    expect(outcome.isError).toBe(false);
    expect(outcome.state.cart.lines).toHaveLength(1);
    expect(outcome.result).toContain("$43.000");
    expect(INITIAL_AGENT_STATE.cart.lines).toHaveLength(0);
  });

  it("refuses to add items when the store is closed", async () => {
    const outcome = await run("add_to_cart", { item_code: "HAM-SEN", quantity: 1 }, INITIAL_AGENT_STATE, context({ isOpen: false }));

    expect(outcome.isError).toBe(true);
    expect(outcome.result).toContain("11:00");
    expect(outcome.state.cart.lines).toHaveLength(0);
  });

  it("refuses to add items when the store paused orders", async () => {
    const outcome = await run(
      "add_to_cart",
      { item_code: "HAM-SEN", quantity: 1 },
      INITIAL_AGENT_STATE,
      context({ isAcceptingOrders: false }),
    );

    expect(outcome.isError).toBe(true);
  });

  it("returns domain errors as tool errors", async () => {
    const outcome = await run("add_to_cart", { item_code: "BEB-LIM", quantity: 1 });

    expect(outcome).toMatchObject({ isError: true, result: expect.stringContaining("agotado") });
  });

  it("rejects invalid input with a readable error", async () => {
    const outcome = await run("add_to_cart", { item_code: "HAM-SEN", quantity: "dos" });

    expect(outcome.isError).toBe(true);
    expect(outcome.result).toContain("quantity");
  });

  it("rejects unknown tools", async () => {
    expect((await run("make_discount", {})).isError).toBe(true);
  });

  it("updates and removes cart lines", async () => {
    const added = await run("add_to_cart", { item_code: "HAM-SEN", quantity: 1 });

    const updated = await run("update_cart_item", { line_id: "L1", quantity: 3 }, added.state);
    const removed = await run("update_cart_item", { line_id: "L1", quantity: 0 }, updated.state);

    expect(updated.state.cart.lines[0]?.quantity).toBe(3);
    expect(removed.state.cart.lines).toHaveLength(0);
  });

  it("shows the cart", async () => {
    const added = await run("add_to_cart", { item_code: "BEB-GAS", quantity: 1, notes: "Coca-Cola" });

    expect((await run("view_cart", {}, added.state)).result).toContain("Coca-Cola");
  });

  it("merges order details and reports what is still missing", async () => {
    const first = await run("set_order_details", { fulfillment: "DELIVERY" });
    const second = await run("set_order_details", { customer_name: "Ana" }, first.state);

    expect(second.state.checkout).toEqual({ fulfillment: "DELIVERY", customerName: "Ana" });
    expect(second.result).toContain("dirección");
  });

  it("drops the address when switching to pickup", async () => {
    const delivery = await run("set_order_details", { fulfillment: "DELIVERY", address: "Cra 1 # 2-3" });
    const pickup = await run("set_order_details", { fulfillment: "PICKUP" }, delivery.state);

    expect(pickup.state.checkout.address).toBeUndefined();
  });

  it("lists missing data instead of requesting confirmation", async () => {
    const added = await run("add_to_cart", { item_code: "HAM-SEN", quantity: 1 });

    const outcome = await run("request_order_confirmation", {}, added.state);

    expect(outcome.isError).toBe(true);
    expect(outcome.effects).toEqual([]);
    expect(outcome.state.pendingConfirmation).toBeNull();
  });

  it("requests confirmation with a server-side quote when everything is ready", async () => {
    const outcome = await run("request_order_confirmation", {}, await readyState());

    expect(outcome.isError).toBe(false);
    expect(outcome.state.pendingConfirmation).toEqual({ total: 18500 });
    expect(outcome.effects).toEqual([{ type: "request_confirmation", quote: expect.objectContaining({ total: 18500 }) }]);
  });

  it("invalidates a pending confirmation when the cart changes", async () => {
    const pending = (await run("request_order_confirmation", {}, await readyState())).state;

    const changed = await run("add_to_cart", { item_code: "BEB-GAS", quantity: 1 }, pending);

    expect(changed.state.pendingConfirmation).toBeNull();
  });

  it("refuses to request confirmation when the store is closed", async () => {
    const outcome = await run("request_order_confirmation", {}, await readyState(), context({ isOpen: false }));

    expect(outcome.isError).toBe(true);
  });

  it("reports recent orders", async () => {
    const ctx = context({
      orders: {
        listRecent: vi.fn().mockResolvedValue([
          { number: 7, status: "PREPARING", total: 23500, fulfillment: "DELIVERY", createdAt: new Date(), itemsText: "1 x Hamburguesa" },
        ]),
        cancel: vi.fn(),
      },
    });

    const outcome = await run("get_order_status", {}, INITIAL_AGENT_STATE, ctx);

    expect(outcome.result).toContain("#7");
    expect(outcome.result).toContain("En preparación");
  });

  it("delegates cancellations to the orders port", async () => {
    const cancel = vi.fn().mockResolvedValue(
      ok({ number: 7, status: "CANCELLED", total: 1, fulfillment: "PICKUP", createdAt: new Date(), itemsText: "" }),
    );

    const outcome = await run("cancel_order", { order_number: 7 }, INITIAL_AGENT_STATE, context({ orders: { listRecent: vi.fn(), cancel } }));

    expect(cancel).toHaveBeenCalledWith(7);
    expect(outcome.isError).toBe(false);
  });

  it("emits a handoff effect", async () => {
    const outcome = await run("transfer_to_human", { reason: "Queja por pedido frío" });

    expect(outcome.effects).toEqual([{ type: "handoff", reason: "Queja por pedido frío" }]);
  });
});
