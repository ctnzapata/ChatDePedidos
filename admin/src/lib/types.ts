/** Espejo de los tipos de la API /api/admin (src/auth/permissions.ts en el backend). */
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

export type StaffRole = "OWNER" | "STAFF" | "COURIER";

export interface Membership {
  readonly staffId: string;
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly role: StaffRole;
  readonly roleLabel: string;
  readonly displayName: string;
  readonly permissions: readonly Permission[];
}

export interface Me {
  readonly userId: string;
  readonly email: string | null;
  readonly memberships: readonly Membership[];
}
