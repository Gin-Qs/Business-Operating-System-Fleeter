"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isBosError } from "@fleeter/contracts";
import { requirePermission } from "@fleeter/domain";
import {
  contextFor,
  inviteMember,
  revokeInvitation,
  revokeMembership,
  withTenantTransaction,
} from "@fleeter/platform";
import { requireSession } from "../../lib/session";

/**
 * Administración de accesos — BC-01.
 *
 * La autorización se verifica aquí, del lado del servidor, contra el Actor
 * resuelto desde la membresía. Que un botón no se muestre a quien no puede es
 * comodidad; esto es el control.
 *
 * Va por acción de servidor y no por `/v1` a propósito: `/v1` es el contrato de
 * negocio que docs/12 §7 define para integraciones, y el gobierno del tenant no
 * es parte de ese corte. La pantalla de configuración sigue el mismo patrón.
 */

export interface TeamActionState {
  error?: string;
  violations?: { rule: string; field?: string; remediation?: string }[];
  invited?: { email: string; roleCode: string; expiresAt: string };
  revoked?: string;
}

const failure = (error: unknown): TeamActionState => {
  if (isBosError(error)) {
    return {
      error: error.message,
      violations: error.violations.map((violation) => ({
        rule: violation.rule,
        field: violation.field,
        remediation: violation.remediation,
      })),
    };
  }
  throw error;
};

export async function inviteMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const session = await requireSession();

  try {
    // Invitar concede un rol: exige las dos facultades, no solo una.
    requirePermission(session.actor, "user:invite");
    requirePermission(session.actor, "role:grant");

    const email = String(formData.get("email") ?? "").trim();
    const roleCode = String(formData.get("role_code") ?? "").trim();
    const legalEntityId = String(formData.get("legal_entity_id") ?? "").trim();
    const expiresInDays = Number(formData.get("expires_in_days") ?? 14);

    if (email === "" || roleCode === "") {
      return { error: "Indica el correo y el rol." };
    }

    const invitation = await withTenantTransaction(
      contextFor(session.actor, randomUUID()),
      (tx) =>
        inviteMember(tx, {
          email,
          roleCode,
          legalEntityId: legalEntityId || null,
          expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : 14,
        }),
    );

    revalidatePath("/workspace/equipo");

    return {
      invited: {
        email: invitation.email,
        roleCode: invitation.roleCode,
        expiresAt: invitation.expiresAt.toISOString().slice(0, 10),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeInvitationAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "role:revoke");

    const invitationId = String(formData.get("invitation_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();

    await withTenantTransaction(contextFor(session.actor, randomUUID()), (tx) =>
      revokeInvitation(tx, invitationId, reason),
    );

    revalidatePath("/workspace/equipo");
    return { revoked: "Invitación retirada." };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeMembershipAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "role:revoke");

    const membershipId = String(formData.get("membership_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();

    await withTenantTransaction(contextFor(session.actor, randomUUID()), (tx) =>
      revokeMembership(tx, membershipId, reason),
    );

    revalidatePath("/workspace/equipo");
    return { revoked: "Acceso retirado." };
  } catch (error) {
    return failure(error);
  }
}
