import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestaurantProvider } from "@/app/restaurant-context";
import type { Membership } from "@/lib/types";
import { StoreStatusToggle } from "./store-status";

const get = vi.fn();
vi.mock("@/auth/use-me", () => ({ useApi: () => ({ get, post: vi.fn(), patch: vi.fn() }) }));

const OWNER: Membership = {
  staffId: "staff-1",
  restaurantId: "rest-1",
  restaurantName: "La Esquina Rápida",
  role: "OWNER",
  roleLabel: "Dueño",
  displayName: "Ana Pérez",
  permissions: ["store:pause"],
};

function renderToggle() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RestaurantProvider memberships={[OWNER]}>
        <StoreStatusToggle />
      </RestaurantProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("StoreStatusToggle", () => {
  it("shows a neutral state while loading instead of claiming the store is open", () => {
    get.mockReturnValue(new Promise(() => undefined));
    renderToggle();

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText("Recibiendo")).not.toBeInTheDocument();
  });

  it("offers a retry when the status cannot be loaded", async () => {
    get.mockRejectedValue(new Error("sin red"));
    renderToggle();

    expect(await screen.findByRole("button", { name: /Sin conexión/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("reflects a paused store", async () => {
    get.mockResolvedValue({ isAcceptingOrders: false });
    renderToggle();

    expect(await screen.findByText("En pausa")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Recibir pedidos por WhatsApp" })).not.toBeChecked();
  });
});
