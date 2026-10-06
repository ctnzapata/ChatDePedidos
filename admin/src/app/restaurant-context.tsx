import { createContext, use, useState, type ReactNode } from "react";
import type { Membership } from "@/lib/types";

const STORAGE_KEY = "panel.restaurantId";

interface RestaurantContextValue {
  readonly membership: Membership;
  readonly memberships: readonly Membership[];
  readonly selectRestaurant: (restaurantId: string) => void;
}

const RestaurantContext = createContext<RestaurantContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(restaurantId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, restaurantId);
  } catch {
    // Sin almacenamiento disponible: se recuerda solo durante la sesión.
  }
}

/** Restaurante activo; se recuerda en este navegador. Requiere al menos una membresía. */
export function RestaurantProvider({ memberships, children }: { memberships: readonly Membership[]; children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(readStored);
  const membership = memberships.find((m) => m.restaurantId === selectedId) ?? memberships[0]!;

  const value: RestaurantContextValue = {
    membership,
    memberships,
    selectRestaurant(restaurantId) {
      store(restaurantId);
      setSelectedId(restaurantId);
    },
  };
  return <RestaurantContext value={value}>{children}</RestaurantContext>;
}

export function useRestaurant(): RestaurantContextValue {
  const context = use(RestaurantContext);
  if (!context) throw new Error("useRestaurant debe usarse dentro de RestaurantProvider");
  return context;
}
