import { ArrowUpRight, ShieldCheck, Waveform } from "@phosphor-icons/react/dist/ssr";
import { ActivationForm } from "./components/activation-form";
import { PortalMark } from "./components/portal-mark";
import { SignInForm } from "./components/sign-in-form";

const accessControls = ["Tenant y entidad legal", "Roles y permisos", "Auditoría por acción"];

export default function AccessPortalPage() {
  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-3 text-[#102521] sm:p-5 lg:p-6">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1440px] overflow-hidden rounded-[2rem] border border-[#d4e0dc] bg-[#f8fbfa] shadow-[0_28px_70px_-38px_rgba(18,57,49,0.38)] lg:grid-cols-[minmax(0,1.04fr)_minmax(440px,0.96fr)] sm:min-h-[calc(100dvh-2.5rem)]">
        <section className="relative overflow-hidden bg-[#0d2521] px-6 py-7 text-[#f6faf8] sm:px-10 sm:py-10 lg:px-14 lg:py-12">
          <div aria-hidden="true" className="absolute inset-0 opacity-60 portal-grid" />
          <div aria-hidden="true" className="absolute -left-24 top-36 h-80 w-80 rounded-full border border-[#5ba594]/20" />
          <div aria-hidden="true" className="absolute -left-8 top-52 h-48 w-48 rounded-full border border-[#5ba594]/20" />

          <div className="relative flex min-h-full flex-col">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-3 text-[#f8fbfa]">
                <PortalMark />
                <div>
                  <p className="text-xs font-bold tracking-[0.18em] text-[#b6d9d0]">FLEETER</p>
                  <p className="text-[11px] font-medium tracking-[0.08em] text-[#82ab9f]">BUSINESS OPERATING SYSTEM</p>
                </div>
              </div>
              <span className="hidden rounded-full border border-[#5fa18f]/40 bg-[#183a34]/80 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#b6d9d0] sm:inline-flex">
                FASE 1
              </span>
            </div>

            <div className="max-w-xl pt-16 sm:pt-24 lg:pt-28">
              <p className="mb-5 text-xs font-semibold tracking-[0.16em] text-[#8cc6b7]">ACCESO OPERATIVO</p>
              <h1 className="max-w-[9ch] text-4xl font-semibold tracking-[-0.055em] text-[#f7fbf9] sm:text-5xl lg:text-6xl">
                Una operación trazable empieza aquí.
              </h1>
              <p className="mt-6 max-w-[47ch] text-base leading-7 text-[#b6ccc6]">
                Accede al espacio de trabajo donde comercial, operación y finanzas comparten una fuente de verdad por cada servicio.
              </p>
            </div>

            <div className="mt-14 grid max-w-2xl gap-3 sm:grid-cols-[1.35fr_0.65fr] lg:mt-auto lg:pt-20">
              <div className="rounded-2xl border border-white/12 bg-white/[0.055] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.13em] text-[#8cc6b7]">ENTORNO</p>
                    <p className="mt-2 text-lg font-semibold text-[#f7fbf9]">Operaciones MX</p>
                  </div>
                  <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#2e7f6d]/20 text-[#a9dfd1]">
                    <Waveform aria-hidden="true" size={20} weight="bold" />
                  </span>
                </div>
                <div className="mt-6 flex items-center gap-2 text-sm text-[#c4dbd5]">
                  <span className="h-2 w-2 rounded-full bg-[#60b99f] portal-status-dot" />
                  Controles de acceso disponibles
                </div>
              </div>

              <div className="border-l border-white/12 py-3 pl-5 sm:pl-6">
                <p className="text-xs font-semibold tracking-[0.13em] text-[#8cc6b7]">PROTECCIÓN</p>
                <ul className="mt-4 space-y-3">
                  {accessControls.map((control) => (
                    <li className="flex items-start gap-2 text-sm leading-5 text-[#c4dbd5]" key={control}>
                      <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[#8cc6b7]" size={17} weight="fill" />
                      {control}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center bg-[#f8fbfa] px-6 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <div className="flex items-center justify-between gap-6">
              <span className="text-xs font-bold tracking-[0.15em] text-[#226b5d]">PORTAL DE ACCESO</span>
              <a
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#537169] transition hover:text-[#1d554a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2"
                href="mailto:soporte@fleeter.mx"
              >
                Soporte
                <ArrowUpRight aria-hidden="true" size={15} weight="bold" />
              </a>
            </div>

            <h2 className="mt-9 text-3xl font-semibold tracking-[-0.045em] text-[#102521] sm:text-4xl">
              Ingresa a tu espacio de trabajo
            </h2>
            <p className="mt-4 max-w-[44ch] text-[15px] leading-6 text-[#60786f]">
              Identifica tu empresa y tus permisos antes de consultar, decidir o ejecutar una operación.
            </p>

            <SignInForm />

            <div className="mt-9 space-y-3 border-t border-[#dbe5e1] pt-5 text-xs leading-5 text-[#71847e]">
              <p>
                Acceso administrado por tenant. Si aún no tienes una cuenta, solicita una invitación a la administración de tu empresa.
              </p>
              <ActivationForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
