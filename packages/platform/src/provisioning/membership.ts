import { BosError } from "@fleeter/contracts";
import { recordAudit } from "../audit/audit-log";
import type { Tx } from "../db/unit-of-work";

/**
 * Membresías — BC-01, gate de salida de Wave 0 (docs/09 §3).
 *
 * "Provisionar y revocar un usuario con permisos de objeto."
 *
 * La autorización (`user:invite`, `role:grant`, `role:revoke`) la verifica el
 * llamador con el Actor; aquí llega resuelta. El tenant NO se recibe como
 * parámetro: lo toma la función SQL del contexto de la transacción, que solo
 * pudo fijar una sesión ya autenticada (ADR-003).
 */

export interface GrantMembershipInput {
  /** Identidad ya existente en el proveedor de identidad. */
  userId: string;
  email: string;
  fullName?: string | null;
  /** Código del rol: `commercial_approver`, `pricing`, o uno propio del tenant. */
  roleCode: string;
  /** NULL concede alcance sobre todas las entidades legales del tenant. */
  legalEntityId?: string | null;
}

export async function grantMembership(
  tx: Tx,
  input: GrantMembershipInput,
): Promise<string> {
  const { rows } = await tx.query<{ membership_id: string }>(
    "select org.grant_membership($1, $2, $3, $4, $5) as membership_id",
    [
      input.userId,
      input.email,
      input.fullName ?? null,
      input.roleCode,
      input.legalEntityId ?? null,
    ],
  );

  const membershipId = rows[0]!.membership_id;

  await recordAudit(tx, {
    action: "RoleGranted",
    entityType: "Membership",
    entityId: membershipId,
    after: {
      user_id: input.userId,
      role_code: input.roleCode,
      legal_entity_id: input.legalEntityId ?? null,
    },
    legalEntityId: input.legalEntityId ?? null,
  });

  return membershipId;
}

/**
 * Revoca una concesión.
 *
 * docs/03 §14.6 exige motivo: una membresía revocada sin causa no se puede
 * revisar después, y en la práctica se restituye por cansancio.
 */
export async function revokeMembership(
  tx: Tx,
  membershipId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new BosError(
      "invalid_input",
      "REVOCATION_REASON_REQUIRED",
      "Revocar un acceso exige un motivo",
      [{ rule: "NO_ORPHAN_REVOCATION", field: "reason" }],
    );
  }

  const { rows } = await tx.query<{ revoke_membership: boolean | null }>(
    "select org.revoke_membership($1, $2) as revoke_membership",
    [membershipId, reason],
  );

  if (!rows[0]?.revoke_membership) {
    // Inexistente, de otro tenant o ya revocada: hacia afuera es lo mismo.
    throw new BosError("not_found", "MEMBERSHIP_NOT_FOUND", "Membresía no encontrada");
  }

  await recordAudit(tx, {
    action: "RoleRevoked",
    entityType: "Membership",
    entityId: membershipId,
    after: { status: "revoked" },
    reason,
  });
}
