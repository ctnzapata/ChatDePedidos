import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { sectionFor } from "@/app/navigation";
import { useRestaurant } from "@/app/restaurant-context";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatClock, formatShortDate } from "@/lib/format";
import { StoreStatusToggle } from "./store-status";

// Zona horaria de los restaurantes del piloto (ver CLAUDE.md).
const RESTAURANT_TIME_ZONE = "America/Bogota";
const CLOCK_REFRESH_MS = 1_000;

/** Hora del local, como el reloj de la cocina. */
function KitchenClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <p className="hidden items-baseline gap-2 text-muted-foreground md:flex">
      <span className="sr-only">Hora del local:</span>
      <span className="label-mono">{formatShortDate(now, RESTAURANT_TIME_ZONE)}</span>
      <span className="font-num text-sm font-medium text-foreground">{formatClock(now, RESTAURANT_TIME_ZONE)}</span>
    </p>
  );
}

/** Barra superior: plegar menú, ubicación, hora del local y estado de la tienda. */
export function TopBar() {
  const { pathname } = useLocation();
  const { membership } = useRestaurant();
  const section = sectionFor(pathname);
  const canPause = membership.permissions.includes("store:pause");

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md md:px-6">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <nav aria-label="Ubicación" className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden truncate text-muted-foreground sm:inline">{membership.restaurantName}</span>
        {section && (
          <>
            <span className="hidden text-border sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate font-medium" aria-current="page">
              {section.label}
            </span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        <KitchenClock />
        {canPause && <StoreStatusToggle />}
      </div>
    </header>
  );
}
