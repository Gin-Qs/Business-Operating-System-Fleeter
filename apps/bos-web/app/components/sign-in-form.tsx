"use client";

import {
  ArrowRight,
  CheckCircle,
  Eye,
  EyeSlash,
  LockKey,
  WarningCircle
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

type FormStatus = "idle" | "submitting" | "success" | "error";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!emailPattern.test(email)) {
      setStatus("error");
      setMessage("Ingresa un correo corporativo válido.");
      return;
    }

    if (password.length < 8) {
      setStatus("error");
      setMessage("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setStatus("submitting");
    setMessage("");
    timerRef.current = window.setTimeout(() => {
      setStatus("success");
      setMessage("La interfaz está lista para conectarse al proveedor de identidad.");
    }, 700);
  }

  const isSubmitting = status === "submitting";

  return (
    <form className="mt-9 space-y-5" noValidate onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[#17332d]" htmlFor="email">
          Correo corporativo
        </label>
        <div className="relative">
          <input
            autoComplete="email"
            className="w-full rounded-xl border border-[#cbd8d4] bg-white px-4 py-3.5 pr-12 text-[15px] text-[#102521] outline-none transition placeholder:text-[#748780] focus:border-[#267768] focus:ring-4 focus:ring-[#267768]/10 disabled:cursor-not-allowed disabled:bg-[#f1f5f3]"
            disabled={isSubmitting}
            id="email"
            name="email"
            placeholder="nombre@empresa.com"
            type="email"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[#5d746c]">
            <LockKey aria-hidden="true" size={19} weight="regular" />
          </span>
        </div>
        <p className="text-xs leading-5 text-[#668078]">Usa la cuenta asignada por el administrador de tu empresa.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm font-semibold text-[#17332d]" htmlFor="password">
            Contraseña
          </label>
          <button
            className="text-xs font-semibold text-[#216b5d] transition hover:text-[#124d42] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2"
            onClick={() => setMessage("Solicita el restablecimiento de acceso a tu administrador del tenant.")}
            type="button"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="w-full rounded-xl border border-[#cbd8d4] bg-white px-4 py-3.5 pr-12 text-[15px] text-[#102521] outline-none transition placeholder:text-[#748780] focus:border-[#267768] focus:ring-4 focus:ring-[#267768]/10 disabled:cursor-not-allowed disabled:bg-[#f1f5f3]"
            disabled={isSubmitting}
            id="password"
            minLength={8}
            name="password"
            placeholder="Ingresa tu contraseña"
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#5d746c] transition hover:text-[#17332d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
            disabled={isSubmitting}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? <EyeSlash aria-hidden="true" size={20} weight="regular" /> : <Eye aria-hidden="true" size={20} weight="regular" />}
          </button>
        </div>
        <p className="text-xs leading-5 text-[#668078]">La autenticación federada se conectará en la siguiente iteración.</p>
      </div>

      <label className="flex cursor-pointer items-center gap-3 text-sm text-[#4a635c]">
        <input
          className="h-4 w-4 rounded border-[#aebfb9] accent-[#267768]"
          defaultChecked
          disabled={isSubmitting}
          name="remember"
          type="checkbox"
        />
        Mantener la sesión en este equipo
      </label>

      {message && (
        <div
          aria-live="polite"
          className={`flex gap-3 rounded-xl border px-4 py-3 text-sm leading-5 ${
            status === "error"
              ? "border-[#e7c8bf] bg-[#fff7f4] text-[#8b3527]"
              : "border-[#b9dacf] bg-[#f1faf6] text-[#176451]"
          }`}
        >
          {status === "error" ? (
            <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={19} weight="fill" />
          ) : (
            <CheckCircle aria-hidden="true" className="mt-0.5 shrink-0" size={19} weight="fill" />
          )}
          <p>{message}</p>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <button
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#1e6f60] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_-16px_rgba(15,67,57,0.65)] transition duration-300 hover:bg-[#155a4e] active:translate-y-px active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8da8a0]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Validando acceso" : "Ingresar al portal"}
          <ArrowRight aria-hidden="true" className={isSubmitting ? "hidden" : "transition-transform duration-300 group-hover:translate-x-0.5"} size={19} weight="bold" />
        </button>
        {isSubmitting && (
          <div aria-label="Validando acceso" className="h-1.5 overflow-hidden rounded-full bg-[#d9e6e1]">
            <div className="h-full w-2/3 rounded-full bg-[#2b806e] portal-loading-bar" />
          </div>
        )}
      </div>

      <p className="pt-1 text-center text-xs leading-5 text-[#71847e]">
        Esta vista no valida credenciales ni conserva sesiones. La integración con el IdP se hará del lado del servidor.
      </p>
    </form>
  );
}
