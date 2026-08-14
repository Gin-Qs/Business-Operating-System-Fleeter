import { randomUUID } from "node:crypto";
import Link from "next/link";
import { hasPermission } from "@fleeter/domain";
import {
  contextFor,
  listGrantableRoles,
  listInvitations,
  listTeamMembers,
  withTenantTransaction,
} from "@fleeter/platform";
import { InviteForm } from "./invite-form";
import { RevokeForm } from "./revoke-form";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Equipo y accesos.
 *
 * Esta pantalla es la respuesta a una pregunta muy concreta: un tenant recién
 * provisionado no puede operar. El propietario tiene `tenant_admin`, que
 * configura pero no cotiza ni aprueba, porque docs/12 §3 separa gobierno de
 * operación a propósito.
 *
 * La salida no es ampliar ese rol hasta que pueda hacerlo todo —eso destruiría
 * la separación de facultades—, sino que conceder facultades sea una capacidad
 * del producto: quien tiene `user:invite` y `role:grant` invita a alguien con el
 * rol que necesita, incluido a sí mismo, y la concesión queda auditada.
 */
export default async function TeamPage() {
  const session = await requireSession();

  const canRead = hasPermission(session.actor, "user:read");
  const canInvite =
    hasPermission(session.actor, "user:invite") && hasPermission(session.actor, "role:grant");
  const canRevoke = hasPermission(session.actor, "role:revoke");

  if (!canRead) {
    return (
      <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h1 className="text-xl font-semibold">Equipo</h1>
          <p className="mt-2 text-sm text-[#60786f]">
            Requiere el permiso <span className="font-mono">user:read</span>.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-[#226b5d]" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  const data = await withTenantTransaction(
    contextFor(session.actor, randomUUID()),
    async (tx) => ({
      members: await listTeamMembers(tx),
      invitations: await listInvitations(tx),
      roles: await listGrantableRoles(tx),
      entities: (
        await tx.query<{ id: string; legal_name: string }>(
          "select id, legal_name from org.legal_entity where status = 'active' order by legal_name",
        )
      ).rows,
    }),
  );

  const pending = data.invitations.filter((invitation) => invitation.status === "pending");
  const resolved = data.invitations.filter((invitation) => invitation.status !== "pending");

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <Link className="text-xs font-semibold text-[#226b5d]" href="/workspace">
            ← Espacio de trabajo
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Equipo y accesos</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Cada rol concede un conjunto de permisos, y el sistema verifica permisos, nunca roles.
            Administrar el tenant y operarlo son facultades distintas: quien configura políticas no
            cotiza ni aprueba, salvo que alguien se lo conceda aquí y quede registrado.
          </p>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Conceder dos roles a la misma persona es una decisión legítima en una operación
            pequeña. Lo que no cambia es que nadie aprueba lo que él mismo solicitó: esa regla mira
            a la persona, no al rol.
          </p>
        </header>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-lg font-semibold">Invitar a alguien</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            La invitación se dirige a un correo. La persona entra al portal con ese mismo correo y
            el acceso queda activo; hasta entonces no existe ninguna cuenta ligada a este tenant.
          </p>

          <InviteForm
            canInvite={canInvite}
            entities={data.entities.map((entity) => ({
              id: entity.id,
              legalName: entity.legal_name,
            }))}
            roles={data.roles.map((role) => ({
              code: role.code,
              name: role.name,
              description: role.description,
              permissions: [...role.permissions],
            }))}
          />
        </section>

        {pending.length > 0 && (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
              INVITACIONES ABIERTAS ({pending.length})
            </h2>
            <ul className="mt-4 space-y-3">
              {pending.map((invitation) => (
                <li
                  className="rounded-xl border border-[#e3ebe8] bg-white px-4 py-3 text-sm"
                  key={invitation.id}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{invitation.email}</span>
                    <span className="text-xs text-[#68807a]">
                      {invitation.roleName} · vence {invitation.expiresAt.toISOString().slice(0, 10)}
                    </span>
                  </div>
                  {canRevoke && (
                    <div className="mt-2">
                      <RevokeForm id={invitation.id} kind="invitation" label="Retirar invitación" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
            PERSONAS CON ACCESO ({data.members.length})
          </h2>

          <ul className="mt-4 space-y-3">
            {data.members.map((member) => (
              <li
                className="rounded-xl border border-[#e3ebe8] bg-white p-4 text-sm"
                key={member.userId}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{member.fullName ?? member.email}</span>
                  <span className="text-xs text-[#68807a]">{member.email}</span>
                </div>

                <ul className="mt-3 space-y-2">
                  {member.memberships.map((membership) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef3f1] pb-2 last:border-0"
                      key={membership.membershipId}
                    >
                      <span className="text-[#17332d]">
                        {membership.roleName}
                        <span className="ml-2 text-xs text-[#68807a]">
                          {membership.legalEntityId
                            ? "alcance por entidad legal"
                            : "todas las entidades legales"}
                        </span>
                      </span>
                      {canRevoke && member.memberships.length > 0 && (
                        <RevokeForm
                          id={membership.membershipId}
                          kind="membership"
                          label="Retirar rol"
                        />
                      )}
                    </li>
                  ))}
                </ul>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
                    PUEDE HACER ({member.permissions.length})
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {member.permissions.map((permission) => (
                      <li
                        className="rounded-full border border-[#e3ebe8] bg-[#f8fbfa] px-2 py-0.5 font-mono text-[11px] text-[#4a635c]"
                        key={permission}
                      >
                        {permission}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>

        {resolved.length > 0 && (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <details>
              <summary className="cursor-pointer text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
                INVITACIONES CERRADAS ({resolved.length})
              </summary>
              <ul className="mt-3 space-y-1.5 text-xs text-[#60786f]">
                {resolved.map((invitation) => (
                  <li className="flex flex-wrap justify-between gap-3" key={invitation.id}>
                    <span>
                      {invitation.email} · {invitation.roleName}
                    </span>
                    <span>
                      {invitation.status}
                      {invitation.revokedReason ? ` — ${invitation.revokedReason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </main>
  );
}
