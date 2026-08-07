/**
 * Traducción de estados y causas a lenguaje de operación.
 *
 * El dominio nombra los estados como docs/03 y docs/12, en inglés y en
 * PascalCase, porque ahí son identificadores de una máquina publicada. Un
 * operador no tiene por qué leer `NeedsInformation` ni `origin_required`, y el
 * dominio no tiene por qué cargar con el idioma de la interfaz: la traducción
 * vive aquí, en la única capa que la necesita.
 */

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  Draft: "Borrador",
  Submitted: "Enviada",
  NeedsInformation: "Falta información",
  Validating: "En validación",
  Accepted: "Aceptada",
  Converted: "Convertida en orden",
  Cancelled: "Cancelada",

  Costed: "Costeada",
  PendingApproval: "Pendiente de aprobación",
  ChangesRequested: "Devuelta a pricing",
  Approved: "Aprobada",
  Sent: "Enviada al cliente",
  Rejected: "Rechazada por el cliente",

  Validated: "Validada",
  Committed: "Comprometida",
};

export const CAUSE_LABEL: Readonly<Record<string, string>> = {
  customer_required: "falta el cliente",
  external_reference_required: "falta la referencia",
  origin_required: "falta el origen",
  destination_required: "falta el destino",
  time_window_required: "falta una ventana completa",
  commodity_required: "falta la mercancía",
  equipment_required: "falta el equipo requerido",
  delivery_before_pickup: "la entrega termina antes de la carga",
  window_end_before_start: "una ventana termina antes de empezar",
};

/** Estados que exigen que alguien haga algo. */
const NEEDS_ACTION = new Set(["NeedsInformation", "PendingApproval", "ChangesRequested"]);
const CLOSED_WELL = new Set(["Accepted", "Converted", "Committed", "Approved"]);
const CLOSED_BADLY = new Set(["Cancelled", "Rejected"]);

export function StatusPill({ status }: { status: string }) {
  const tone = NEEDS_ACTION.has(status)
    ? "border-[#e7c8bf] bg-[#fff7f4] text-[#8b3527]"
    : CLOSED_WELL.has(status)
      ? "border-[#b9dacf] bg-[#f1faf6] text-[#176451]"
      : CLOSED_BADLY.has(status)
        ? "border-[#d9dedc] bg-[#f2f5f4] text-[#5c6b66]"
        : "border-[#cbd8d4] bg-white text-[#17332d]";

  return (
    <span className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Importe con su moneda, redondeado al exponente de presentación. */
export function formatAmount(value: string, currency: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const decimals = currency === "JPY" || currency === "CLP" ? 0 : 2;
  const rounded = decimals === 0 ? whole : `${whole}.${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
  const grouped = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${grouped} ${currency}`;
}

/** Fracción a porcentaje. NULL se muestra como tal, no como 0%. */
export function formatPercent(value: string | null): string {
  // docs/12 §8: un margen sin ingreso es nulo, no cero. Mostrar "0.00%" diría
  // que el margen es malo cuando lo que pasa es que no se puede calcular.
  if (value === null) return "no calculable";
  return `${(Number(value) * 100).toFixed(2)}%`;
}
