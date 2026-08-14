import { BosError, isPermission, type Permission } from "@fleeter/contracts";
import { recordAudit } from "../audit/audit-log";
import { appPool } from "../db/pool";
import type { Tx } from "../db/unit-of-work";

/**
 * Invitaciones y administración de accesos — BC-01, gate de Wave 0.
 *
 * Es la capacidad que hace operable un tenant recién provisionado sin ampliar
 * `tenant_admin` hasta convertirlo en un superusuario. El propietario no puede
 * cotizar ni aprobar —docs/12 §3 separa gobierno de operación a propósito—, pero
 * sí puede **conceder esas facultades a alguien**, incluida a sí mismo, y esa
 * concesión queda auditada con actor, rol y momento.
 *
 * Que el administrador pueda darse un rol operativo no rompe la separación de
 * facultades: la separación que importa es la de docs/03 §14.3, y esa se evalúa
 * sobre la PERSONA, no sobre el rol. Quien pide una excepción de margen no puede
 * aprobarla aunque tenga los dos roles.
 */

export interface InviteInput {
  email: string;
  /** Código del rol: `commercial_executive`, `pricing`, o uno propio. */
  roleCode: string;
  /** NULL concede alcance sobre todas las entidades legales del tenant. */
  legalEntityId?: string | null;
  /** Vigencia de la invitación. Por defecto, dos semanas. */
  expiresInDays?: number;
}

export interface InvitationRecord {
  id: string;
  email: string;
  roleCode: string;
  roleName: string;
  legalEntityId: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedReason: string | null;
}

/**
 * `expired` se CALCULA al leer, no se guarda.
 *
 * docs/03 §14.5 usa "vencido" como su ejemplo de estado derivado que no debe
 * mantenerse a mano. Si dependiera de que alguien pase a marcarlo, la pantalla
 * mostraría como viva una invitación que ya no sirve, y el administrador
 * esperaría a alguien que nunca podría entrar.
 *
 * La columna `status` sí se actualiza al redimir, pero solo como registro de lo
 * ocurrido; lo que se muestra y lo que decide es esta expresión.
 */
const INVITATION_COLUMNS = `i.id, i.email, r.code as "roleCode", r.name as "roleName",
       i.legal_entity_id as "legalEntityId",
       (case when i.status = 'pending' and i.expires_at <= now() then 'expired'
             else i.status::text end) as status,
       i.invited_at as "invitedAt", i.expires_at as "expiresAt",
       i.accepted_at as "acceptedAt", i.revoked_reason as "revokedReason"`;

/**
 * Invita a un correo con un rol.
 *
 * No comprueba si esa persona ya tiene identidad en la plataforma, y es
 * deliberado: quien invita no debería poder averiguar en qué otras empresas
 * trabaja alguien. La identidad se ata cuando la persona entra.
 */
export async function inviteMember(tx: Tx, input: InviteInput): Promise<InvitationRecord> {
  const email = input.email.trim().toLowerCase();

  const { rows: roleRows } = await tx.query<{ id: string }>(
    `select id from org.role
     where code = $1 and (tenant_id = $2 or tenant_id is null)
     order by tenant_id nulls last limit 1`,
    [input.roleCode, tx.context.tenantId],
  );

  const role = roleRows[0];
  if (!role) {
    throw new BosError("invalid_input", "ROLE_NOT_FOUND", `El rol ${input.roleCode} no existe`, [
      { rule: "KNOWN_ROLE_REQUIRED", field: "role_code" },
    ]);
  }

  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 14) * 24 * 3600 * 1000);

  const { rows: upserted } = await tx.query<{ id: string }>(
    `insert into org.invitation
       (tenant_id, email, role_id, legal_entity_id, invited_by, expires_at, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tenant_id, lower(email), role_id,
                  coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
       where status = 'pending'
       -- Reinvitar a quien ya está invitado renueva la vigencia en lugar de
       -- fallar: es lo que quiere decir quien vuelve a pulsar el botón.
       do update set expires_at = excluded.expires_at, invited_at = now()
     returning id`,
    [
      tx.context.tenantId,
      email,
      role.id,
      input.legalEntityId ?? null,
      tx.context.actorId,
      expiresAt.toISOString(),
      tx.context.correlationId,
    ],
  );

  const invitation = await requireInvitation(tx, upserted[0]!.id);

  await recordAudit(tx, {
    action: "UserInvited",
    entityType: "Invitation",
    entityId: invitation.id,
    after: {
      email,
      role_code: invitation.roleCode,
      legal_entity_id: input.legalEntityId ?? null,
      expires_at: invitation.expiresAt.toISOString(),
    },
    legalEntityId: input.legalEntityId ?? null,
  });

  return invitation;
}

async function requireInvitation(tx: Tx, invitationId: string): Promise<InvitationRecord> {
  const { rows } = await tx.query<InvitationRecord>(
    `select ${INVITATION_COLUMNS}
     from org.invitation i join org.role r on r.id = i.role_id
     where i.id = $1`,
    [invitationId],
  );

  const invitation = rows[0];
  if (!invitation) throw new BosError("not_found", "INVITATION_NOT_FOUND", "Invitación no encontrada");
  return invitation;
}

export async function listInvitations(tx: Tx): Promise<InvitationRecord[]> {
  const { rows } = await tx.query<InvitationRecord>(
    `select ${INVITATION_COLUMNS}
     from org.invitation i join org.role r on r.id = i.role_id
     order by case when i.status = 'pending' and i.expires_at > now() then 0 else 1 end,
              i.invited_at desc
     limit 200`,
  );

  return rows;
}

export async function revokeInvitation(
  tx: Tx,
  invitationId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new BosError(
      "invalid_input",
      "REVOCATION_REASON_REQUIRED",
      "Retirar una invitación exige un motivo",
      [{ rule: "NO_ORPHAN_REVOCATION", field: "reason" }],
    );
  }

  const { rows } = await tx.query<{ id: string; email: string }>(
    `update org.invitation
     set status = 'revoked', revoked_at = now(), revoked_reason = $2
     where id = $1 and status = 'pending'
     returning id, email`,
    [invitationId, reason],
  );

  if (!rows[0]) {
    // Inexistente, de otro tenant o ya resuelta: hacia afuera es lo mismo.
    throw new BosError("not_found", "INVITATION_NOT_FOUND", "Invitación no encontrada");
  }

  await recordAudit(tx, {
    action: "InvitationRevoked",
    entityType: "Invitation",
    entityId: invitationId,
    after: { status: "revoked" },
    reason,
  });
}

// ---------------------------------------------------------------------------
// Redención
// ---------------------------------------------------------------------------

export interface RedeemedInvitation {
  tenantId: string;
  membershipId: string;
  roleCode: string;
}

/**
 * Convierte en membresías las invitaciones pendientes de una identidad.
 *
 * Se llama al iniciar sesión, antes de resolver el tenant: una persona invitada
 * que entra por primera vez todavía no tiene ninguna membresía, así que sin esto
 * vería el mismo "cuenta sin acceso" que alguien a quien nadie invitó.
 *
 * Va contra el pool de aplicación sin contexto de tenant porque todavía no hay
 * ninguno; la función SQL es SECURITY DEFINER y verifica que el correo sea el de
 * la identidad autenticada.
 */
export async function redeemInvitations(
  userId: string,
  email: string,
  fullName?: string | null,
): Promise<RedeemedInvitation[]> {
  const { rows } = await appPool().query<{
    tenant_id: string;
    membership_id: string;
    role_code: string;
  }>("select * from org.redeem_invitations($1, $2, $3)", [userId, email, fullName ?? null]);

  return rows.map((row) => ({
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    roleCode: row.role_code,
  }));
}

/**
 * Si un correo tiene invitación viva.
 *
 * La usa el portal antes de permitir crear una identidad. La respuesta NO debe
 * llegar al usuario tal cual: el portal contesta lo mismo invite o no invite,
 * porque si no, la pantalla de activación sería un oráculo para averiguar quién
 * trabaja dónde.
 */
export async function hasPendingInvitation(email: string): Promise<boolean> {
  const { rows } = await appPool().query<{ invited: boolean }>(
    "select org.has_pending_invitation($1) as invited",
    [email.trim().toLowerCase()],
  );

  return rows[0]?.invited ?? false;
}

// ---------------------------------------------------------------------------
// Lectura del equipo
// ---------------------------------------------------------------------------

export interface TeamMember {
  userId: string;
  email: string;
  fullName: string | null;
  status: string;
  memberships: {
    membershipId: string;
    roleCode: string;
    roleName: string;
    legalEntityId: string | null;
    grantedAt: Date;
  }[];
  permissions: Permission[];
}

/**
 * Personas con acceso al tenant y qué puede hacer cada una.
 *
 * Los permisos van agregados por persona, no por rol: es la pregunta que un
 * administrador se hace de verdad —"¿quién puede aprobar una cotización?"— y
 * responderla mirando roles obliga a recomponer mentalmente la unión.
 */
export async function listTeamMembers(tx: Tx): Promise<TeamMember[]> {
  const { rows } = await tx.query<{
    user_id: string;
    email: string;
    full_name: string | null;
    status: string;
    membership_id: string;
    role_code: string;
    role_name: string;
    legal_entity_id: string | null;
    granted_at: Date;
    permissions: string[];
  }>(
    `select ua.id as user_id, ua.email, ua.full_name, ua.status::text as status,
            m.id as membership_id, r.code as role_code, r.name as role_name,
            m.legal_entity_id, m.granted_at,
            coalesce(array_agg(rp.permission order by rp.permission)
                     filter (where rp.permission is not null), '{}') as permissions
     from org.membership m
     join org.user_account ua on ua.id = m.user_id
     join org.role r on r.id = m.role_id
     left join org.role_permission rp on rp.role_id = r.id
     where m.status = 'active'
     group by ua.id, ua.email, ua.full_name, ua.status, m.id, r.code, r.name,
              m.legal_entity_id, m.granted_at
     order by ua.email, r.code`,
  );

  const byUser = new Map<string, TeamMember>();

  for (const row of rows) {
    let member = byUser.get(row.user_id);
    if (!member) {
      member = {
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        status: row.status,
        memberships: [],
        permissions: [],
      };
      byUser.set(row.user_id, member);
    }

    member.memberships.push({
      membershipId: row.membership_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      legalEntityId: row.legal_entity_id,
      grantedAt: row.granted_at,
    });

    for (const permission of row.permissions) {
      // Un permiso que la base conoce y el catálogo no es una migración a
      // medias: se descarta en lugar de propagarse como permiso desconocido.
      if (isPermission(permission) && !member.permissions.includes(permission)) {
        member.permissions.push(permission);
      }
    }
  }

  for (const member of byUser.values()) member.permissions.sort();

  return [...byUser.values()];
}

export interface RoleOption {
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
}

/** Roles que el tenant puede conceder: los de sistema más los propios. */
export async function listGrantableRoles(tx: Tx): Promise<RoleOption[]> {
  const { rows } = await tx.query<{
    code: string;
    name: string;
    description: string | null;
    is_system: boolean;
    permissions: string[];
  }>(
    `select r.code, r.name, r.description, r.is_system,
            coalesce(array_agg(rp.permission order by rp.permission)
                     filter (where rp.permission is not null), '{}') as permissions
     from org.role r
     left join org.role_permission rp on rp.role_id = r.id
     where r.tenant_id is null or r.tenant_id = plt.current_tenant_id()
     group by r.code, r.name, r.description, r.is_system
     order by r.is_system desc, r.name`,
  );

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions: row.permissions.filter(isPermission),
  }));
}
