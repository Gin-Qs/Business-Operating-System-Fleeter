"use client";

import { PlayCircle, WarningCircle } from "@phosphor-icons/react";
import { useActionState } from "react";
import { signInAsDemo } from "../actions/demo";
import type { SignInState } from "../actions/auth";

const INITIAL: SignInState = {};

/**
 * Un botón, sin campos.
 *
 * El formulario va vacío a propósito: la credencial demo vive en el entorno del
 * servidor y no se escribe en el HTML. Un `value` oculto con la contraseña
 * bastaría para que cualquiera la leyera desde el navegador y la reutilizara
 * fuera de este botón.
 */
export function DemoAccessButton() {
  const [state, formAction, isPending] = useActionState(
    async () => signInAsDemo(),
    INITIAL,
  );

  return (
    <form action={formAction} className="space-y-3">
      <button
        className="group flex w-full items-center justify-center gap-2 rounded-xl border border-[#1e6f60]/35 bg-white px-5 py-3.5 text-sm font-semibold text-[#1a5e51] transition duration-300 hover:border-[#1e6f60] hover:bg-[#f1f8f5] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        <PlayCircle aria-hidden="true" size={19} weight="fill" />
        {isPending ? "Preparando la demostración" : "Entrar a la demostración"}
      </button>

      <p className="text-xs leading-5 text-[#71847e]">
        Cuenta de administrador sobre un tenant propio, <strong>Fleeter Demo</strong>. No alcanza
        los datos de ningún otro tenant.
      </p>

      {state.error && (
        <div
          aria-live="polite"
          className="flex gap-3 rounded-xl border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-sm leading-5 text-[#8b3527]"
        >
          <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={19} weight="fill" />
          <p>{state.error}</p>
        </div>
      )}
    </form>
  );
}
