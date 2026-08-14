"use client";

import { useActionState, useState } from "react";
import { inviteMemberAction, type TeamActionState } from "../../actions/team";

const INITIAL: TeamActionState = {};

export interface RoleChoice {
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface EntityChoice {
  id: string;
  legalName: string;
}

const inputClass =
  "w-full rounded-lg border border-[#cbd8d4] bg-white px-3 py-2 text-sm text-[#102521] outline-none transition focus:border-[#267768] focus:ring-2 focus:ring-[#267768]/15 disabled:bg-[#f1f5f3]";

export function InviteForm({
  roles,
  entities,
  canInvite,
}: {
  roles: RoleChoice[];
  entities: EntityChoice[];
  canInvite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(inviteMemberAction, INITIAL);
  const [roleCode, setRoleCode] = useState(roles[0]?.code ?? "");

  const selected = roles.find((role) => role.code === roleCode);

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
            CORREO
          </span>
          <input
            className={inputClass}
            disabled={!canInvite || isPending}
            name="email"
            placeholder="persona@empresa.mx"
            required
            type="email"
          />
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">ROL</span>
          <select
            className={inputClass}
            disabled={!canInvite || isPending}
            name="role_code"
            onChange={(event) => setRoleCode(event.target.value)}
            value={roleCode}
          >
            {roles.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
            ALCANCE
          </span>
          <select className={inputClass} disabled={!canInvite || isPending} name="legal_entity_id">
            <option value="">Todas las entidades legales</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.legalName}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
            VIGENCIA DE LA INVITACIÓN (DÍAS)
          </span>
          <input
            className={inputClass}
            defaultValue={14}
            disabled={!canInvite || isPending}
            max={90}
            min={1}
            name="expires_in_days"
            type="number"
          />
        </label>
      </div>

      {selected && (
        <div className="rounded-lg border border-[#e3ebe8] bg-white px-4 py-3">
          {selected.description && (
            <p className="text-sm text-[#60786f]">{selected.description}</p>
          )}
          <p className="mt-2 text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
            CONCEDE {selected.permissions.length} PERMISOS
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {selected.permissions.map((permission) => (
              <li
                className="rounded-full border border-[#e3ebe8] bg-[#f8fbfa] px-2 py-0.5 font-mono text-[11px] text-[#4a635c]"
                key={permission}
              >
                {permission}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.error && (
        <div className="rounded-lg border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-sm text-[#8b3527]">
          <p className="font-semibold">{state.error}</p>
          {state.violations && state.violations.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {state.violations.map((violation, index) => (
                <li key={`${violation.rule}-${index}`}>
                  {violation.remediation ?? violation.rule}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.invited && (
        <div className="rounded-lg border border-[#b9dacf] bg-[#f1faf6] px-4 py-3 text-sm text-[#176451]">
          Invitación creada para <strong>{state.invited.email}</strong> como{" "}
          {state.invited.roleCode}, vigente hasta {state.invited.expiresAt}. La persona entra desde
          el portal con ese mismo correo.
        </div>
      )}

      <button
        className="rounded-lg bg-[#1e6f60] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#155a4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8da8a0]"
        disabled={!canInvite || isPending}
        type="submit"
      >
        {isPending ? "Invitando…" : "Invitar"}
      </button>

      {!canInvite && (
        <p className="text-xs text-[#68807a]">
          Requiere los permisos <span className="font-mono">user:invite</span> y{" "}
          <span className="font-mono">role:grant</span>.
        </p>
      )}
    </form>
  );
}
