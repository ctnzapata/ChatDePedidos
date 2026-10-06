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

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission: Permission;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Resumen", icon: LayoutDashboardIcon, permission: "metrics:read" },
  { to: "/pedidos", label: "Pedidos", icon: ReceiptTextIcon, permission: "orders:read" },
  { to: "/entregas", label: "Mis entregas", icon: BikeIcon, permission: "deliveries:own" },
  { to: "/menu", label: "Menú", icon: UtensilsCrossedIcon, permission: "menu:availability" },
  { to: "/atencion", label: "Atención", icon: MessagesSquareIcon, permission: "conversations:manage" },
  { to: "/equipo", label: "Equipo", icon: UsersIcon, permission: "team:manage" },
  { to: "/ajustes", label: "Ajustes", icon: Settings2Icon, permission: "settings:manage" },
];

export const NO_ACCESS_PATH = "/sin-acceso";

/** Secciones visibles según los permisos del rol (la API vuelve a validar cada acción). */
export function navigationFor(permissions: readonly Permission[]): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission));
}

export function homePathFor(permissions: readonly Permission[]): string {
  return navigationFor(permissions)[0]?.to ?? NO_ACCESS_PATH;
}
