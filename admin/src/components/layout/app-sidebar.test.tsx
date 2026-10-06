import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { RestaurantProvider } from "@/app/restaurant-context";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Membership, Permission } from "@/lib/types";
import { AppSidebar } from "./app-sidebar";

const OWNER_PERMISSIONS: Permission[] = [
  "orders:read",
  "orders:manage",
  "menu:availability",
  "store:pause",
  "conversations:manage",
  "team:manage",
  "metrics:read",
  "settings:manage",
];

const membership = (overrides: Partial<Membership> = {}): Membership => ({
  staffId: "staff-1",
  restaurantId: "rest-1",
  restaurantName: "La Esquina Rápida",
  role: "OWNER",
  roleLabel: "Dueño",
  displayName: "Ana Pérez",
  permissions: OWNER_PERMISSIONS,
  ...overrides,
});

function renderSidebar(memberships: Membership[], path = "/pedidos") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <RestaurantProvider memberships={memberships}>
          <SidebarProvider>
            <AppSidebar footer={<span>Pie de usuario</span>} />
            <SidebarTrigger />
          </SidebarProvider>
        </RestaurantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const sidebarElement = (container: HTMLElement) => container.querySelector('[data-slot="sidebar"]');

describe("AppSidebar", () => {
  it("shows the restaurant, the grouped sections and the footer", () => {
    renderSidebar([membership()]);

    expect(screen.getByText("La Esquina Rápida")).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    for (const group of ["Operación", "Catálogo", "Administración"]) {
      expect(within(nav).getByText(group)).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(6);
    expect(screen.getByText("Pie de usuario")).toBeInTheDocument();
  });

  it("marks the current section", () => {
    renderSidebar([membership()], "/pedidos");

    expect(screen.getByRole("link", { name: "Pedidos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Resumen" })).not.toHaveAttribute("aria-current");
  });

  it("shows a courier only their deliveries", () => {
    renderSidebar([membership({ role: "COURIER", roleLabel: "Domiciliario", permissions: ["deliveries:own"] })], "/entregas");

    const nav = screen.getByRole("navigation", { name: "Secciones" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Mis entregas"]);
  });

  it("collapses to an icon rail and keeps accessible link names", async () => {
    const { container } = renderSidebar([membership()]);
    expect(sidebarElement(container)).toHaveAttribute("data-state", "expanded");

    await userEvent.click(screen.getByRole("button", { name: "Mostrar u ocultar el menú" }));

    expect(sidebarElement(container)).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByRole("link", { name: "Pedidos" })).toBeInTheDocument();
  });

  it("toggles with Ctrl+B", async () => {
    const { container } = renderSidebar([membership()]);

    await userEvent.keyboard("{Control>}b{/Control}");

    expect(sidebarElement(container)).toHaveAttribute("data-state", "collapsed");
  });
});
