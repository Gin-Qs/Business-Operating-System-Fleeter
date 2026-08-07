import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSession,
  closePools,
  hasPendingInvitation,
  inviteMember,
  listInvitations,
  listMemberships,
  listTeamMembers,
  redeemInvitations,
  revokeInvitation,
  revokeMembership,
  withTenantTransaction,
} from "@fleeter/platform";
import {
  FIXTURE_EMAILS,
  FIXTURE_USERS,
  contextFor,
  hasDatabase,
  provisionTestTenants,
  type TestTenant,
} from "./fixtures";

/**
 * Alta y baja de personas — gate de salida de Wave 0 (docs/09 §3).
 *
 * "Provisionar y revocar un usuario con permisos de objeto."
 *
 * Lo que se prueba es que un tenant recién provisionado se pueda poner a
 * operar: el propietario tiene `tenant_admin`, que no cotiza ni aprueba, y
 * necesita poder conceder esas facultades sin que nadie toque la consola del
 * proveedor de identidad.
 */

describe.skipIf(!hasDatabase)("acceso al tenant", () => {
  let alpha: TestTenant;
  let beta: TestTenant;

  const asAlpha = <T,>(fn: Parameters<typeof withTenantTransaction<T>>[1]) =>
    withTenantTransaction(contextFor(alpha), fn);

  beforeAll(async () => {
    ({ alpha, beta } = await provisionTestTenants());
  });

  afterAll(async () => {
    await closePools();
  });

  it("invitar no exige conocer si esa persona ya existe en la plataforma", async () => {
    // Se invita a un CORREO. Quien invita no debería poder averiguar en qué
    // otras empresas trabaja alguien, así que la invitación se crea igual exista
    // la identidad o no.
    const desconocido = await asAlpha((tx) =>
      inviteMember(tx, { email: "nadie.todavia@fleeter.test", roleCode: "operations" }),
    );

    expect(desconocido.status).toBe("pending");
    expect(desconocido.roleCode).toBe("operations");
    expect(desconocido.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reinvitar renueva la vigencia en lugar de duplicar", async () => {
    const first = await asAlpha((tx) =>
      inviteMember(tx, { email: "repetida@fleeter.test", roleCode: "pricing", expiresInDays: 1 }),
    );
    const second = await asAlpha((tx) =>
      inviteMember(tx, { email: "REPETIDA@fleeter.test", roleCode: "pricing", expiresInDays: 30 }),
    );

    // El correo se normaliza: las mayúsculas no crean una invitación distinta.
    expect(second.id).toBe(first.id);
    expect(second.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());

    const pending = await asAlpha((tx) => listInvitations(tx));
    expect(pending.filter((i) => i.email === "repetida@fleeter.test")).toHaveLength(1);
  });

  it("aceptar una invitación convierte a la persona en miembro con sus permisos", async () => {
    await asAlpha((tx) =>
      inviteMember(tx, {
        email: FIXTURE_EMAILS.alphaInvitee,
        roleCode: "commercial_executive",
      }),
    );

    // Antes de aceptar, la identidad existe pero no tiene dónde entrar.
    const before = await listMemberships(FIXTURE_USERS.alphaInvitee);
    expect(before.filter((m) => m.tenantId === alpha.tenantId)).toHaveLength(0);

    const redeemed = await redeemInvitations(
      FIXTURE_USERS.alphaInvitee,
      FIXTURE_EMAILS.alphaInvitee,
      "Invitada Alpha",
    );

    expect(redeemed.map((r) => r.roleCode)).toContain("commercial_executive");

    const after = await listMemberships(FIXTURE_USERS.alphaInvitee);
    const session = buildSession(FIXTURE_USERS.alphaInvitee, after, alpha.tenantId);

    // Y ya puede hacer lo que su rol permite, que es el punto de todo esto.
    expect(session.actor.permissions.has("service_request:create")).toBe(true);
    expect(session.actor.permissions.has("quote:approve")).toBe(false);

    // Volver a redimir no duplica la membresía.
    const again = await redeemInvitations(FIXTURE_USERS.alphaInvitee, FIXTURE_EMAILS.alphaInvitee);
    expect(again).toHaveLength(0);
  });

  it("no se puede redimir la invitación de otro correo", async () => {
    await asAlpha((tx) =>
      inviteMember(tx, { email: "objetivo@fleeter.test", roleCode: "operations" }),
    );

    // El correo tiene que ser el de la identidad autenticada. Sin esa
    // comprobación, cualquiera podría quedarse con la invitación de otro.
    await expect(
      redeemInvitations(FIXTURE_USERS.betaOwner, "objetivo@fleeter.test"),
    ).rejects.toThrowError(/no corresponde al correo/);
  });

  it("una invitación vencida no concede acceso", async () => {
    const email = "vencida@fleeter.test";

    await asAlpha(async (tx) => {
      await inviteMember(tx, { email, roleCode: "operations" });
      // Se envejece a mano: la vigencia mínima que acepta la API es un día.
      await tx.query(
        "update org.invitation set expires_at = now() - interval '1 day' where lower(email) = $1",
        [email],
      );
    });

    expect(await hasPendingInvitation(email)).toBe(false);

    const redeemed = await redeemInvitations(FIXTURE_USERS.alphaAuditor, email).catch(() => null);
    // El correo no coincide con la identidad, así que ni siquiera llega a
    // evaluarla; lo que importa es que la invitación ya está caducada.
    expect(redeemed).toBeNull();

    const invitations = await asAlpha((tx) => listInvitations(tx));
    expect(invitations.find((i) => i.email === email)?.status).toBe("expired");
  });

  it("retirar una invitación exige motivo y la deja sin efecto", async () => {
    const invitation = await asAlpha((tx) =>
      inviteMember(tx, { email: "retirada@fleeter.test", roleCode: "auditor" }),
    );

    await expect(asAlpha((tx) => revokeInvitation(tx, invitation.id, "  "))).rejects.toThrowError(
      /motivo/,
    );

    await asAlpha((tx) => revokeInvitation(tx, invitation.id, "Cambió de puesto antes de entrar"));

    expect(await hasPendingInvitation("retirada@fleeter.test")).toBe(false);

    const invitations = await asAlpha((tx) => listInvitations(tx));
    const retirada = invitations.find((i) => i.id === invitation.id);
    expect(retirada?.status).toBe("revoked");
    expect(retirada?.revokedReason).toBe("Cambió de puesto antes de entrar");
  });

  it("el equipo muestra los permisos efectivos de cada persona, no sus roles", async () => {
    const team = await asAlpha((tx) => listTeamMembers(tx));
    const owner = team.find((member) => member.userId === alpha.ownerUserId);

    expect(owner?.memberships.map((m) => m.roleCode)).toContain("tenant_admin");
    // La pregunta que un administrador se hace es "quién puede publicar una
    // política", no "quién tiene tal rol".
    expect(owner?.permissions).toContain("policy:publish");
    // Y la respuesta enseña también lo que NO puede: gobierno no es operación.
    expect(owner?.permissions).not.toContain("quote:approve");
  });

  it("el administrador puede concederse un rol operativo, y queda auditado", async () => {
    // Esto es lo que hace usable un tenant recién provisionado. No rompe la
    // separación de facultades: la que importa (docs/03 §14.3) se evalúa sobre
    // la persona, no sobre el rol, y sigue impidiendo aprobar lo propio.
    await asAlpha((tx) =>
      inviteMember(tx, { email: FIXTURE_EMAILS.alphaOwner, roleCode: "commercial_executive" }),
    );

    await redeemInvitations(alpha.ownerUserId, FIXTURE_EMAILS.alphaOwner);

    const memberships = await listMemberships(alpha.ownerUserId);
    const session = buildSession(alpha.ownerUserId, memberships, alpha.tenantId);

    expect(session.active.roleCodes).toEqual(
      expect.arrayContaining(["tenant_admin", "commercial_executive"]),
    );
    expect(session.actor.permissions.has("service_request:create")).toBe(true);

    const audited = await asAlpha(async (tx) => {
      const { rows } = await tx.query<{ action: string }>(
        `select action from plt.audit_log
         where action in ('UserInvited', 'InvitationAccepted')
         order by occurred_at desc limit 5`,
      );
      return rows.map((row) => row.action);
    });

    expect(audited).toContain("InvitationAccepted");
    expect(audited).toContain("UserInvited");
  });

  it("revocar una membresía retira el acceso y conserva la historia", async () => {
    const team = await asAlpha((tx) => listTeamMembers(tx));
    const invitee = team.find((member) => member.userId === FIXTURE_USERS.alphaInvitee);
    const membershipId = invitee!.memberships[0]!.membershipId;

    await asAlpha((tx) => revokeMembership(tx, membershipId, "Fin de la relación laboral"));

    const after = await listMemberships(FIXTURE_USERS.alphaInvitee);
    expect(after.filter((m) => m.tenantId === alpha.tenantId)).toHaveLength(0);

    const history = await asAlpha(async (tx) => {
      const { rows } = await tx.query<{ status: string; revoked_reason: string }>(
        "select status::text as status, revoked_reason from org.membership where id = $1",
        [membershipId],
      );
      return rows[0];
    });

    // No se borra: queda revocada con su motivo (docs/03 §14.1 y §14.6).
    expect(history?.status).toBe("revoked");
    expect(history?.revoked_reason).toBe("Fin de la relación laboral");
  });

  it("las invitaciones de un tenant son invisibles para otro", async () => {
    await asAlpha((tx) => inviteMember(tx, { email: "privada@fleeter.test", roleCode: "pricing" }));

    const seenByBeta = await withTenantTransaction(contextFor(beta), (tx) => listInvitations(tx));

    expect(seenByBeta.some((i) => i.email === "privada@fleeter.test")).toBe(false);
  });

  it("no se puede invitar con un rol de otro tenant ni inventado", async () => {
    await expect(
      asAlpha((tx) => inviteMember(tx, { email: "x@fleeter.test", roleCode: "dueno_absoluto" })),
    ).rejects.toThrowError(/no existe/);
  });
});
