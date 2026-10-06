import { err, ok, type Result } from "../lib/result.ts";

export const STAFF_ROLES = ["OWNER", "STAFF", "COURIER"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: "Dueño",
  STAFF: "Personal",
  COURIER: "Domiciliario",
};

export type Permission =
  | "orders:read"
  | "orders:manage"
  | "deliveries:own"
  | "menu:availability"
  | "store:pause"
  | "conversations:manage"
  | "team:manage"
  | "metrics:read"
  | "settings:manage";

const STAFF_PERMISSIONS: readonly Permission[] = [
  "orders:read",
  "orders:manage",
  "menu:availability",
  "store:pause",
  "conversations:manage",
];

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: [...STAFF_PERMISSIONS, "team:manage", "metrics:read", "settings:manage"],
  STAFF: STAFF_PERMISSIONS,
  COURIER: ["deliveries:own"],
};

/** Membresía activa de un usuario en un restaurante. */
export interface Membership {
  readonly staffId: string;
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly role: StaffRole;
  readonly displayName: string;
}

export type AuthorizationError = "NOT_MEMBER" | "FORBIDDEN";

export function permissionsFor(role: StaffRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Verifica que el usuario sea personal activo del restaurante y que su rol tenga el permiso. */
export function authorize(
  memberships: readonly Membership[],
  restaurantId: string,
  permission: Permission,
): Result<Membership, AuthorizationError> {
  const membership = memberships.find((m) => m.restaurantId === restaurantId);
  if (!membership) return err("NOT_MEMBER");
  return can(membership.role, permission) ? ok(membership) : err("FORBIDDEN");
}
