import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { NavLink, Outlet } from "react-router";
import { toast } from "sonner";
import { navigationFor, type NavItem } from "@/app/navigation";
import { useRestaurant } from "@/app/restaurant-context";
import { useAuth } from "@/auth/auth-provider";
import { useApi, useMe } from "@/auth/use-me";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

function BrandMark({ name }: { name: string }) {
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-lg text-primary-foreground shadow-[var(--shadow-soft)]">
      {initials(name)}
    </span>
  );
}

function RestaurantSwitcher() {
  const { membership, memberships, selectRestaurant } = useRestaurant();
  if (memberships.length < 2) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark name={membership.restaurantName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{membership.restaurantName}</p>
          <p className="text-xs text-muted-foreground">{membership.roleLabel}</p>
        </div>
      </div>
    );
  }
  return (
    <Select value={membership.restaurantId} onValueChange={selectRestaurant}>
      <SelectTrigger aria-label="Restaurante" className="h-auto w-full py-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {memberships.map((m) => (
          <SelectItem key={m.restaurantId} value={m.restaurantId}>
            {m.restaurantName} · {m.roleLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors duration-200",
          "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-brand transition-opacity duration-200",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <Icon className={cn("size-4", isActive ? "text-brand" : "text-muted-foreground")} aria-hidden />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function MobileNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, minmax(0, 1fr))` }}
    >
      {items.slice(0, 5).map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground transition-colors",
                isActive && "text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("size-5", isActive && "text-brand")} aria-hidden />
                {item.label}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function UserMenu({ isCompact = false }: { isCompact?: boolean }) {
  const { signOut } = useAuth();
  const { data: me } = useMe();
  const { membership } = useRestaurant();
  const { theme, setTheme } = useTheme();
  const name = membership.displayName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-3 rounded-xl text-left transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isCompact ? "p-1" : "w-full p-2",
        )}
        aria-label="Menú de usuario"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand">{initials(name)}</AvatarFallback>
        </Avatar>
        {!isCompact && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me?.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Apariencia</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon aria-hidden /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon aria-hidden /> Oscuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon aria-hidden /> Según el sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon aria-hidden /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface StoreStatus {
  readonly isAcceptingOrders: boolean;
}

/** Pausar o reanudar la toma de pedidos del agente de WhatsApp. */
function StoreStatusToggle() {
  const { membership } = useRestaurant();
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = ["store", membership.restaurantId];
  const { data } = useQuery({ queryKey, queryFn: () => api.get<StoreStatus>(`/restaurants/${membership.restaurantId}/store`) });
  const mutation = useMutation({
    mutationFn: (isAcceptingOrders: boolean) =>
      api.post<StoreStatus>(`/restaurants/${membership.restaurantId}/accepting`, { isAcceptingOrders }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      toast.success(result.isAcceptingOrders ? "Volviste a recibir pedidos" : "Pedidos en pausa");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const isOpen = data?.isAcceptingOrders ?? true;

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        isOpen ? "border-success/30 bg-success-soft text-success" : "border-warning/40 bg-warning-soft text-foreground",
      )}
    >
      <span className={cn("size-2 rounded-full", isOpen ? "animate-pulse bg-success" : "bg-warning")} aria-hidden />
      {isOpen ? "Recibiendo pedidos" : "Pedidos en pausa"}
      <Switch
        checked={isOpen}
        disabled={!data || mutation.isPending}
        onCheckedChange={(checked) => mutation.mutate(checked)}
        aria-label="Recibir pedidos"
      />
    </label>
  );
}

/** Estructura del panel: barra lateral en escritorio y barra inferior en el celular. */
export function AppShell() {
  const { membership } = useRestaurant();
  const items = navigationFor(membership.permissions);
  const canPause = membership.permissions.includes("store:pause");

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar lg:flex">
        <div className="px-4 pt-5 pb-4">
          <RestaurantSwitcher />
        </div>
        <nav aria-label="Secciones" className="flex-1 space-y-0.5 px-3 py-2">
          {items.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="border-t p-3">
          <UserMenu />
        </div>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-lg lg:px-10">
          <div className="min-w-0 lg:hidden">
            <RestaurantSwitcher />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canPause && <StoreStatusToggle />}
            <div className="lg:hidden">
              <UserMenu isCompact />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 pt-8 pb-28 lg:px-10 lg:pt-12 lg:pb-16">
          <div className="mx-auto max-w-6xl animate-in fade-in-0 slide-in-from-bottom-1 duration-500">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNav items={items} />
    </div>
  );
}
