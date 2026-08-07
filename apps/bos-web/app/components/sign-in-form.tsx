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
        <label className="block text-sm font-semibold text-[#17332d]" htmlFor="email">
          Correo corporativo
        </label>
        <div className="relative">
          <input
            autoComplete="email"
            className="w-full rounded-xl border border-[#cbd8d4] bg-white px-4 py-3.5 pr-12 text-[15px] text-[#102521] outline-none transition placeholder:text-[#748780] focus:border-[#267768] focus:ring-4 focus:ring-[#267768]/10 disabled:cursor-not-allowed disabled:bg-[#f1f5f3]"
            disabled={isPending}
            id="email"
            name="email"
            placeholder="nombre@empresa.com"
            required
            type="email"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[#5d746c]">
            <LockKey aria-hidden="true" size={19} weight="regular" />
          </span>
        </div>
        <p className="text-xs leading-5 text-[#668078]">
          Usa la cuenta asignada por el administrador de tu empresa.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[#17332d]" htmlFor="password">
          Contraseña
        </label>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="w-full rounded-xl border border-[#cbd8d4] bg-white px-4 py-3.5 pr-12 text-[15px] text-[#102521] outline-none transition placeholder:text-[#748780] focus:border-[#267768] focus:ring-4 focus:ring-[#267768]/10 disabled:cursor-not-allowed disabled:bg-[#f1f5f3]"
            disabled={isPending}
            id="password"
            name="password"
            placeholder="Ingresa tu contraseña"
            required
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#5d746c] transition hover:text-[#17332d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
            disabled={isPending}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? (
              <EyeSlash aria-hidden="true" size={20} weight="regular" />
            ) : (
              <Eye aria-hidden="true" size={20} weight="regular" />
            )}
          </button>
        </div>
      </div>

      {state.error && (
        <div
          aria-live="polite"
          className="flex gap-3 rounded-xl border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-sm leading-5 text-[#8b3527]"
        >
          <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={19} weight="fill" />
          <p>{state.error}</p>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <button
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#1e6f60] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_-16px_rgba(15,67,57,0.65)] transition duration-300 hover:bg-[#155a4e] active:translate-y-px active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8da8a0]"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Validando acceso" : "Ingresar al portal"}
          <ArrowRight
            aria-hidden="true"
            className={
              isPending ? "hidden" : "transition-transform duration-300 group-hover:translate-x-0.5"
            }
            size={19}
            weight="bold"
          />
        </button>
        {isPending && (
          <div aria-label="Validando acceso" className="h-1.5 overflow-hidden rounded-full bg-[#d9e6e1]">
            <div className="h-full w-2/3 rounded-full bg-[#2b806e] portal-loading-bar" />
          </div>
        )}
      </div>
    </form>
  );
}
