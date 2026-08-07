"use client";

import { ArrowRight, Eye, EyeSlash, LockKey, WarningCircle } from "@phosphor-icons/react";
import { useActionState, useState } from "react";
import { signIn, type SignInState } from "../actions/auth";

const INITIAL: SignInState = {};

export function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="mt-9 space-y-5">
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--fleeter-ink)]" htmlFor="email">
          Correo corporativo
        </label>
        <div className="relative">
          <input
            autoComplete="email"
            className="bos-input px-4 py-3.5 pr-12 text-[15px] disabled:cursor-not-allowed"
            disabled={isPending}
            id="email"
            name="email"
            placeholder="nombre@empresa.com"
            required
            type="email"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[var(--fleeter-steel)]">
            <LockKey aria-hidden="true" size={19} weight="regular" />
          </span>
        </div>
        <p className="text-xs leading-5 text-[var(--fleeter-steel)]">Usa la cuenta asignada por el administrador de tu empresa.</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[var(--fleeter-ink)]" htmlFor="password">
          Contraseña
        </label>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="bos-input px-4 py-3.5 pr-12 text-[15px] disabled:cursor-not-allowed"
            disabled={isPending}
            id="password"
            name="password"
            placeholder="Ingresa tu contraseña"
            required
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[var(--fleeter-steel)] transition hover:text-[var(--fleeter-ink)]"
            disabled={isPending}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? <EyeSlash aria-hidden="true" size={20} weight="regular" /> : <Eye aria-hidden="true" size={20} weight="regular" />}
          </button>
        </div>
      </div>

      {state.error && (
        <div aria-live="polite" className="flex gap-3 border border-[rgba(192,57,43,0.35)] bg-[rgba(192,57,43,0.07)] px-4 py-3 text-sm leading-5 text-[var(--fleeter-incident)]">
          <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={19} weight="fill" />
          <p>{state.error}</p>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <button className="bos-button group flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold" disabled={isPending} type="submit">
          {isPending ? "Validando acceso" : "Ingresar al portal"}
          <ArrowRight aria-hidden="true" className={isPending ? "hidden" : "transition-transform duration-200 group-hover:translate-x-0.5"} size={19} weight="bold" />
        </button>
        {isPending && (
          <div aria-label="Validando acceso" className="h-1 overflow-hidden bg-[var(--fleeter-mist)]">
            <div className="portal-loading-bar h-full w-2/3 bg-[var(--fleeter-signal)]" />
          </div>
        )}
      </div>
    </form>
  );
}
