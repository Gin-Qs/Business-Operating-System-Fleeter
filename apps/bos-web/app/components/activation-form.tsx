"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useActionState, useState } from "react";
import { activateAccount, type ActivationState } from "../actions/auth";

const INITIAL: ActivationState = {};

const inputClass =
  "w-full rounded-xl border border-[#cbd8d4] bg-white px-4 py-3 text-[15px] text-[#102521] outline-none transition placeholder:text-[#748780] focus:border-[#267768] focus:ring-4 focus:ring-[#267768]/10 disabled:cursor-not-allowed disabled:bg-[#f1f5f3]";

/**
 * Activación de una cuenta invitada.
 *
 * Va plegada porque no es el camino habitual: casi todo el mundo que llega aquí
 * ya tiene cuenta. Quien fue invitado y todavía no entró necesita encontrarla,
 * pero no debería estorbar al resto.
 */
export function ActivationForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(activateAccount, INITIAL);

  if (!open) {
    return (
      <button
        className="text-xs font-semibold text-[#226b5d] underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
        onClick={() => setOpen(true)}
        type="button"
      >
        Me invitaron y aún no tengo contraseña
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-xs font-semibold tracking-[0.08em] text-[#4a635c]">ACTIVAR MI ACCESO</p>
      <p className="text-xs leading-5 text-[#668078]">
        Usa el mismo correo con el que te invitaron. Si nadie te ha invitado todavía, pídeselo a la
        administración de tu empresa.
      </p>

      <input
        autoComplete="email"
        className={inputClass}
        disabled={isPending}
        name="email"
        placeholder="nombre@empresa.com"
        required
        type="email"
      />
      <input
        autoComplete="new-password"
        className={inputClass}
        disabled={isPending}
        minLength={8}
        name="password"
        placeholder="Contraseña nueva (mínimo 8 caracteres)"
        required
        type="password"
      />

      {state.error && (
        <div
          aria-live="polite"
          className="flex gap-2 rounded-xl border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-xs leading-5 text-[#8b3527]"
        >
          <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={16} weight="fill" />
          <p>{state.error}</p>
        </div>
      )}

      {state.notice && (
        <div
          aria-live="polite"
          className="flex gap-2 rounded-xl border border-[#b9dacf] bg-[#f1faf6] px-4 py-3 text-xs leading-5 text-[#176451]"
        >
          <CheckCircle aria-hidden="true" className="mt-0.5 shrink-0" size={16} weight="fill" />
          <p>{state.notice}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          className="rounded-xl bg-[#1e6f60] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#155a4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8da8a0]"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Activando…" : "Activar acceso"}
        </button>
        <button
          className="text-xs font-semibold text-[#5d746c] transition hover:text-[#17332d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
          onClick={() => setOpen(false)}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
