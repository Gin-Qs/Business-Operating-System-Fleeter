import { ArrowUpRight, CheckCircle, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { FleeterLogo } from "./components/fleeter-logo";
import { SignInForm } from "./components/sign-in-form";

const accessControls = ["Tenant y entidad legal", "Roles y permisos", "Auditoría por acción"];

export default function AccessPortalPage() {
  return (
    <main className="min-h-[100dvh] p-3 sm:p-5 lg:p-6" id="main-content">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1440px] overflow-hidden rounded-2xl border border-[rgba(95,100,105,0.24)] bg-[var(--fleeter-paper)] shadow-[0_28px_70px_-38px_rgba(22,24,27,0.48)] sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
        <section className="relative overflow-hidden bg-[var(--fleeter-ink)] px-6 py-7 text-[var(--fleeter-paper)] sm:px-10 sm:py-10 lg:px-14 lg:py-12">
          <div aria-hidden="true" className="certainty-grid absolute inset-0" />
          <div aria-hidden="true" className="absolute -left-24 top-36 h-80 w-80 rounded-full border border-white/10" />
          <div aria-hidden="true" className="absolute -left-8 top-52 h-48 w-48 rounded-full border border-white/10" />

          <div className="relative flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-6">
              <div>
                <FleeterLogo className="w-60" priority variant="evolution" />
                <p className="mt-4 text-[10px] font-semibold tracking-[0.18em] text-[var(--fleeter-mist)]">
                  BUSINESS OPERATING SYSTEM
                </p>
              </div>
              <span className="hidden border border-white/15 px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--fleeter-mist)] sm:inline-flex">
                FASE 0
              </span>
            </div>

            <div className="max-w-xl pt-16 sm:pt-24 lg:pt-28">
              <p className="bos-label mb-5 text-[var(--fleeter-signal)]">ACCESO OPERATIVO</p>
              <h1 className="max-w-[10ch] text-4xl font-semibold tracking-[-0.06em] text-white text-balance sm:text-5xl lg:text-6xl">
                La operación empieza con certeza.
              </h1>
              <p className="mt-6 max-w-[48ch] text-base leading-7 text-[var(--fleeter-mist)]">
                Accede al espacio donde comercial, operación y finanzas comparten una fuente de verdad por cada servicio.
              </p>
            </div>

            <div className="mt-14 max-w-2xl lg:mt-auto lg:pt-20">
              <div className="grid gap-6 border-y border-white/14 py-5 sm:grid-cols-[1.35fr_0.65fr] sm:gap-8">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="bos-label text-[var(--fleeter-mist)]">ENTORNO</p>
                      <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">Operaciones MX</p>
                    </div>
                    <CheckCircle aria-hidden="true" className="text-[var(--fleeter-success)]" size={24} weight="fill" />
                  </div>
                  <div className="mt-7 space-y-2">
                    <div className="relative h-1 certainty-route" />
                    <div className="flex justify-between bos-mono text-[10px] uppercase tracking-[0.1em] text-[var(--fleeter-mist)]">
                      <span>Validado</span>
                      <span>Espacio activo</span>
                    </div>
                  </div>
                </div>

                <div className="border-l border-white/14 pl-5 sm:pl-6">
                  <p className="bos-label text-[var(--fleeter-mist)]">PROTECCIÓN</p>
                  <ul className="mt-4 space-y-3">
                    {accessControls.map((control) => (
                      <li className="flex items-start gap-2 text-sm leading-5 text-[var(--fleeter-mist)]" key={control}>
                        <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--fleeter-signal)]" size={17} weight="regular" />
                        {control}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center bg-[rgba(255,255,255,0.34)] px-6 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <div className="flex items-center justify-between gap-6 border-b border-[rgba(95,100,105,0.22)] pb-5">
              <span className="bos-label text-[var(--fleeter-ink)]">PORTAL PRIVADO</span>
              <a
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--fleeter-steel)] transition hover:text-[var(--fleeter-ember)]"
                href="mailto:soporte@fleeter.mx"
              >
                Soporte
                <ArrowUpRight aria-hidden="true" size={15} weight="bold" />
              </a>
            </div>

            <h2 className="mt-9 text-3xl font-semibold tracking-[-0.055em] text-[var(--fleeter-ink)] text-balance sm:text-4xl">
              Ingresa a tu espacio de trabajo
            </h2>
            <p className="mt-4 max-w-[44ch] text-[15px] leading-6 text-[var(--fleeter-steel)]">
              Identifica tu empresa y tus permisos antes de consultar, decidir o ejecutar una operación.
            </p>

            <SignInForm />

            <p className="mt-9 border-t border-[rgba(95,100,105,0.22)] pt-5 text-xs leading-5 text-[var(--fleeter-steel)]">
              Acceso administrado por tenant. Si aún no tienes una cuenta, solicita una invitación a la administración de tu empresa.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
