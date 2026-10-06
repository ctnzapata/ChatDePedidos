import {
  BikeIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  ReceiptTextIcon,
  Settings2Icon,
  UsersIcon,
  UtensilsCrossedIcon,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/types";

type NavGroupId = "operation" | "catalog" | "admin";

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission: Permission;
  readonly group: NavGroupId;
}

export interface NavGroup {
  readonly id: NavGroupId;
  readonly label: string;
  readonly items: readonly NavItem[];
}

const NAV_GROUPS: readonly { readonly id: NavGroupId; readonly label: string }[] = [
  { id: "operation", label: "Operación" },
  { id: "catalog", label: "Catálogo" },
  { id: "admin", label: "Administración" },
];

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Resumen", icon: LayoutDashboardIcon, permission: "metrics:read", group: "operation" },
  { to: "/pedidos", label: "Pedidos", icon: ReceiptTextIcon, permission: "orders:read", group: "operation" },
  { to: "/entregas", label: "Mis entregas", icon: BikeIcon, permission: "deliveries:own", group: "operation" },
  { to: "/atencion", label: "Atención", icon: MessagesSquareIcon, permission: "conversations:manage", group: "operation" },
  { to: "/menu", label: "Menú", icon: UtensilsCrossedIcon, permission: "menu:availability", group: "catalog" },
  { to: "/equipo", label: "Equipo", icon: UsersIcon, permission: "team:manage", group: "admin" },
  { to: "/ajustes", label: "Ajustes", icon: Settings2Icon, permission: "settings:manage", group: "admin" },
];

export const NO_ACCESS_PATH = "/sin-acceso";

/** Secciones visibles según los permisos del rol (la API vuelve a validar cada acción). */
export function navigationFor(permissions: readonly Permission[]): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission));
}

/** Secciones visibles agrupadas para la barra lateral; omite los grupos vacíos. */
export function navigationGroupsFor(permissions: readonly Permission[]): NavGroup[] {
  const visible = navigationFor(permissions);
  return NAV_GROUPS.map((group) => ({ ...group, items: visible.filter((item) => item.group === group.id) })).filter(
    (group) => group.items.length > 0,
  );
}

/** Sección a la que pertenece una ruta (también rutas anidadas como /equipo/123). */
export function sectionFor(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS.find((item) => item.to === "/");
  return NAV_ITEMS.find((item) => item.to !== "/" && (pathname === item.to || pathname.startsWith(`${item.to}/`)));
}

export function homePathFor(permissions: readonly Permission[]): string {
  return navigationFor(permissions)[0]?.to ?? NO_ACCESS_PATH;
}
