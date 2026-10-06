import type { StaffRole } from "../auth/permissions.ts";
import type { UserAdmin } from "../auth/user-admin.ts";
import { err, ok, type Result } from "../lib/result.ts";
import type { MemberChanges, StaffRepository, TeamMember } from "../repositories/staff-repository.ts";

export interface TeamServiceDeps {
  readonly staff: StaffRepository;
  readonly userAdmin: UserAdmin;
  /** Página a la que llega el enlace de invitación (el panel). */
  readonly inviteRedirectUrl: string;
}

export interface InviteInput {
  readonly email: string;
  readonly displayName: string;
  readonly role: StaffRole;
}

export interface TeamError {
  readonly code: "NOT_FOUND" | "LAST_OWNER" | "INVITE_FAILED";
  readonly message: string;
}

/** Gestión del equipo del restaurante. Solo la usa el dueño (permiso team:manage). */
export class TeamService {
  constructor(private readonly deps: TeamServiceDeps) {}

  list(restaurantId: string): Promise<TeamMember[]> {
    return this.deps.staff.listTeam(restaurantId);
  }

  /** Invita por correo; si la persona ya tiene cuenta, solo la agrega al restaurante. */
  async invite(restaurantId: string, input: InviteInput): Promise<Result<TeamMember, TeamError>> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.deps.userAdmin.findUserIdByEmail(email);
    let userId = existing;
    if (!userId) {
      const invited = await this.deps.userAdmin.inviteByEmail(email, this.deps.inviteRedirectUrl, input.displayName);
      if (!invited.ok) return err({ code: "INVITE_FAILED", message: invited.error });
      userId = invited.value;
    }
    const member = await this.deps.staff.addOrReactivate({
      userId,
      restaurantId,
      role: input.role,
      displayName: input.displayName.trim(),
    });
    return ok(member);
  }

  async update(restaurantId: string, staffId: string, changes: MemberChanges): Promise<Result<TeamMember, TeamError>> {
    const current = await this.deps.staff.findMember(restaurantId, staffId);
    if (!current) return err({ code: "NOT_FOUND", message: "Miembro no encontrado." });

    const removesAnOwner =
      current.role === "OWNER" &&
      current.isActive &&
      (changes.isActive === false || (changes.role !== undefined && changes.role !== "OWNER"));
    if (removesAnOwner && (await this.deps.staff.countActiveOwners(restaurantId)) <= 1) {
      return err({ code: "LAST_OWNER", message: "El restaurante debe tener al menos un dueño activo." });
    }

    const updated = await this.deps.staff.update(restaurantId, staffId, changes);
    return updated ? ok(updated) : err({ code: "NOT_FOUND", message: "Miembro no encontrado." });
  }
}
