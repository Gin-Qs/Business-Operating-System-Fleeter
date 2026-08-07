"use client";

import { useActionState } from "react";
import {
  revokeInvitationAction,
  revokeMembershipAction,
  type TeamActionState,
} from "../../actions/team";

const INITIAL: TeamActionState = {};

/**
 * Retirar un acceso o una invitación.
 *
 * El motivo es obligatorio y no se puede saltar desde la interfaz porque
 * tampoco se puede saltar en el dominio (docs/03 §14.6): un acceso retirado sin
 * causa no se puede revisar después, y quien lo revisa acaba restituyéndolo por
 * no saber por qué se quitó.
 */
export function RevokeForm({
  kind,
  id,
  label,
}: {
  kind: "invitation" | "membership";
  id: string;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(
    kind === "invitation" ? revokeInvitationAction : revokeMembershipAction,
    INITIAL,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input name={kind === "invitation" ? "invitation_id" : "membership_id"} type="hidden" value={id} />
      <input
        className="w-56 rounded-lg border border-[#cbd8d4] bg-white px-3 py-1.5 text-xs text-[#102521] outline-none transition focus:border-[#267768] focus:ring-2 focus:ring-[#267768]/15"
        disabled={isPending}
        name="reason"
        placeholder="Motivo (queda en la auditoría)"
        required
      />
      <button
        className="rounded-lg border border-[#cbd8d4] bg-white px-3 py-1.5 text-xs font-semibold text-[#8b3527] transition hover:border-[#c98d7d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] disabled:cursor-not-allowed disabled:text-[#a8b5b1]"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Retirando…" : label}
      </button>
      {state.error && <span className="text-xs text-[#8b3527]">{state.error}</span>}
      {state.revoked && <span className="text-xs text-[#176451]">{state.revoked}</span>}
    </form>
  );
}
