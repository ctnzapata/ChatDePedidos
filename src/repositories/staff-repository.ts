import type { Membership, StaffRole } from "../auth/permissions.ts";
import type { Db } from "../db/client.ts";

export interface TeamMember {
  readonly staffId: string;
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface CourierOption {
  readonly staffId: string;
  readonly displayName: string;
}

export interface NewMember {
  readonly userId: string;
  readonly restaurantId: string;
  readonly role: StaffRole;
  readonly displayName: string;
}

export interface MemberChanges {
  readonly role?: StaffRole;
  readonly isActive?: boolean;
  readonly displayName?: string;
}

export class StaffRepository {
  constructor(private readonly db: Db) {}

  /** Membresías activas del usuario, para autorizar cada petición del panel. */
  async listMemberships(userId: string): Promise<Membership[]> {
    const rows = await this.db.staffMember.findMany({
      where: { userId, isActive: true },
      include: { restaurant: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      staffId: row.id,
      restaurantId: row.restaurantId,
      restaurantName: row.restaurant.name,
      role: row.role,
      displayName: row.displayName,
    }));
  }

  /** Equipo del restaurante con el correo de cada usuario (tabla auth.users de Supabase). */
  async listTeam(restaurantId: string): Promise<TeamMember[]> {
    return this.db.$queryRaw<TeamMember[]>`
      select s.id::text as "staffId", s.user_id::text as "userId", u.email::text as email,
             s.display_name as "displayName", s.role::text as role, s.is_active as "isActive", s.created_at as "createdAt"
      from staff_members s
      left join auth.users u on u.id = s.user_id
      where s.restaurant_id = ${restaurantId}::uuid
      order by s.is_active desc, s.created_at asc`;
  }

  async findMember(restaurantId: string, staffId: string): Promise<TeamMember | null> {
    const team = await this.listTeam(restaurantId);
    return team.find((member) => member.staffId === staffId) ?? null;
  }

  async listActiveCouriers(restaurantId: string): Promise<CourierOption[]> {
    const rows = await this.db.staffMember.findMany({
      where: { restaurantId, role: "COURIER", isActive: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    });
    return rows.map((row) => ({ staffId: row.id, displayName: row.displayName }));
  }

  /** Agrega al usuario al restaurante; si ya existía (aunque esté inactivo) lo reactiva con el nuevo rol. */
  async addOrReactivate(member: NewMember): Promise<TeamMember> {
    const row = await this.db.staffMember.upsert({
      where: { userId_restaurantId: { userId: member.userId, restaurantId: member.restaurantId } },
      create: member,
      update: { role: member.role, displayName: member.displayName, isActive: true },
    });
    const saved = await this.findMember(member.restaurantId, row.id);
    if (!saved) throw new Error("La membresía recién guardada no se encontró");
    return saved;
  }

  async update(restaurantId: string, staffId: string, changes: MemberChanges): Promise<TeamMember | null> {
    const result = await this.db.staffMember.updateMany({ where: { id: staffId, restaurantId }, data: changes });
    return result.count > 0 ? this.findMember(restaurantId, staffId) : null;
  }

  async countActiveOwners(restaurantId: string): Promise<number> {
    return this.db.staffMember.count({ where: { restaurantId, role: "OWNER", isActive: true } });
  }
}
