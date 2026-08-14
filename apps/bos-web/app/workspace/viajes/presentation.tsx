import type { ReleaseCauseCode } from "@fleeter/domain";

/**
 * Vocabulario de la pantalla de viajes.
 *
 * Las causas del gate se traducen aquí y no en el núcleo por una razón: el
 * núcleo devuelve un código estable que una integración puede programar, y la
 * pantalla necesita una frase que un planeador entienda a las 4 de la mañana.
 * Mezclarlos obligaría a cambiar el contrato de la API cada vez que alguien
 * quisiera redactar mejor un mensaje.
 */

export const TRIP_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  planned: "Planeado",
  assigned: "Asignado",
  confirmed: "Confirmado",
  released: "Liberado",
  en_route_to_origin: "En ruta al origen",
  at_origin: "En origen",
  loading: "Cargando",
  in_transit: "En tránsito",
  at_destination: "En destino",
  unloading: "Descargando",
  delivered: "Entregado",
  operationally_closed: "Cerrado",
  cancelled: "Cancelado",
  aborted: "Abortado",
};

/** Qué tendría que hacer alguien para resolver cada causa. */
export const CAUSE_REMEDY: Record<ReleaseCauseCode, string> = {
  order_not_committed: "La orden todavía no está lista para ejecutarse",
  route_plan_not_active: "Activar la versión del plan de ruta que se va a ejecutar",
  assignment_missing: "Asignar unidad y operador al viaje",
  assignment_not_confirmed: "Confirmar la asignación con los recursos",
  vehicle_missing: "Asignar una unidad",
  vehicle_not_eligible: "Revisar el estado de la unidad o levantar su bloqueo",
  trailer_not_eligible: "Revisar el estado del remolque o levantar su bloqueo",
  driver_missing: "Asignar un operador",
  driver_not_eligible: "Revisar el estado del operador o levantar su bloqueo",
  credential_expired: "Renovar la credencial vencida en Flota → Credenciales",
  capacity_exceeded: "Asignar una unidad con más capacidad o dividir la carga",
  equipment_incompatible: "Asignar un remolque del tipo que la orden requiere",
  driver_double_booked: "Elegir otro operador o cerrar su viaje en curso",
  stop_contact_missing: "Capturar contacto en las paradas señaladas",
};

const TONE: Record<string, string> = {
  neutral: "bg-[#e6efec] text-[#3d5a52]",
  progress: "bg-[#dce9f5] text-[#28516e]",
  good: "bg-[#dcefe4] text-[#1f6b45]",
  warn: "bg-[#f8ecd8] text-[#8a5a12]",
  bad: "bg-[#f7dedd] text-[#8c2f2a]",
};

const TRIP_TONE: Record<string, keyof typeof TONE> = {
  draft: "neutral",
  planned: "neutral",
  assigned: "neutral",
  confirmed: "progress",
  released: "progress",
  en_route_to_origin: "progress",
  at_origin: "progress",
  loading: "progress",
  in_transit: "progress",
  at_destination: "progress",
  unloading: "progress",
  delivered: "good",
  operationally_closed: "good",
  cancelled: "bad",
  aborted: "bad",
};

export function TripStatusPill({ status }: { status: string }) {
  const tone = TONE[TRIP_TONE[status] ?? "neutral"];
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {TRIP_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const STOP_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approaching: "Aproximándose",
  arrived: "En sitio",
  servicing: "En maniobra",
  completed: "Completada",
  partially_completed: "Parcial",
  rejected: "Rechazada",
  failed: "Fallida",
  skipped: "Omitida",
};

export const EVIDENCE_STATUS_LABEL: Record<string, string> = {
  required: "Pendiente",
  satisfied: "Aceptada",
  waived: "Dispensada",
};
