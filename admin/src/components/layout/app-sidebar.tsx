import type { ReactNode } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { NavLink } from "react-router";
import { navigationGroupsFor, type NavItem } from "@/app/navigation";
import { useRestaurant } from "@/app/restaurant-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sello del restaurante: iniciales sobre el acento de marca. */
export function BrandMark({ name, label, className }: { name: string; label?: string; className?: string }) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand font-display text-[0.95rem] leading-none text-brand-foreground shadow-[inset_0_-2px_0_oklch(0_0_0/0.18)]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function RestaurantIdentity({ name, role }: { name: string; role: string }) {
  return (
    <>
      {/* En el riel plegado el texto se oculta: el sello conserva el nombre para lectores de pantalla. */}
      <BrandMark name={name} label={name} />
      <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">{name}</span>
        <span className="label-mono truncate text-[0.625rem] text-sidebar-muted">{role}</span>
      </span>
    </>
  );
}

/** Restaurante activo; si la persona trabaja en varios, permite cambiar. */
function RestaurantSwitcher() {
  const { membership, memberships, selectRestaurant } = useRestaurant();
  const identity = <RestaurantIdentity name={membership.restaurantName} role={membership.roleLabel} />;

  if (memberships.length < 2) {
    return <div className="flex items-center gap-2.5 p-1">{identity}</div>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="gap-2.5 px-1" aria-label="Cambiar de restaurante">
          {identity}
          <ChevronsUpDownIcon className="ml-auto text-sidebar-muted group-data-[collapsible=icon]:hidden" aria-hidden />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-64">
        <DropdownMenuLabel className="label-mono text-muted-foreground">Restaurantes</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.restaurantId} onSelect={() => selectRestaurant(m.restaurantId)} className="gap-2.5">
            <BrandMark name={m.restaurantName} className="size-6 text-xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{m.restaurantName}</span>
              <span className="block text-xs text-muted-foreground">{m.roleLabel}</span>
            </span>
            {m.restaurantId === membership.restaurantId && <CheckIcon aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={item.label}
        className={cn(
          "relative h-9 gap-3 text-sidebar-foreground transition-colors duration-150",
          "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand before:opacity-0 before:transition-opacity",
          "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:before:opacity-100",
          "[&>svg]:text-sidebar-muted aria-[current=page]:[&>svg]:text-brand hover:[&>svg]:text-sidebar-accent-foreground",
          "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center",
        )}
      >
        <NavLink to={item.to} end={item.to === "/"} onClick={() => isMobile && setOpenMobile(false)}>
          <Icon aria-hidden />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

type AppSidebarProps = {
  /** Menú de la persona (tema y cerrar sesión), al pie de la barra. */
  footer: ReactNode;
};

/** Barra lateral de carbón: se pliega a un riel de íconos (botón, borde o Ctrl+B) y en el celular es un cajón. */
export function AppSidebar({ footer }: AppSidebarProps) {
  const { membership } = useRestaurant();
  const groups = navigationGroupsFor(membership.permissions);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-2.5 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <RestaurantSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Secciones" className="py-2">
          {groups.map((group) => (
            <SidebarGroup key={group.id} className="px-2.5 py-1.5">
              <SidebarGroupLabel className="label-mono h-7 px-2 text-[0.625rem] text-sidebar-muted">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <SidebarLink key={item.to} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2.5">{footer}</SidebarFooter>
      {/* Borde clicable para el mouse (fuera del orden de tabulación); el botón de la barra superior y Ctrl+B también pliegan. */}
      <SidebarRail />
    </Sidebar>
  );
}
