import { BosError } from "@fleeter/contracts";
import {
  assessClosure,
  deriveOutcome,
  requirePermission,
  stopExecutionLifecycle,
  tripLifecycle,
  validateQuantities,
  type Actor,
  type DeliveryLine,
  type StopExecutionState,
} from "@fleeter/domain";
import { enqueueEvent, recordAudit, type Tx } from "@fleeter/platform";
import { notFound } from "../shared/command";
import { STOP_EXECUTION_DB, toStopExecutionState } from "../shared/states";
import { getTrip } from "./trips";

/**
 * Ejecución de paradas y desenlace de entrega — docs/13 §5, §8 y §9.
 *
 * La regla que gobierna el módulo: el estado de una parada NO se captura, se
 * deriva de las cantidades (docs/03 §14.5). Con una lista desplegable habría
 * paradas marcadas "completas" con seis tarimas faltantes, y el nivel de
 * servicio mediría lo que alguien tecleó en vez de lo que ocurrió.
 */

export interface StopExecutionRecord {
  id: string;
  tripId: string;
  sequence: number;
  status: StopExecutionState;
  kind: "pickup" | "delivery";
  locationName: string;
  arrivedAt: Date | null;
  departedAt: Date | null;
}

const STOP_COLUMNS = `se.id, se.trip_id as "tripId", se.sequence,
       se.status::text as status, s.kind::text as kind,
       l.name as "locationName", se.arrived_at as "arrivedAt",
       se.departed_at as "departedAt"`;

const STOP_FROM = `from trn.stop_execution se
       join trn.route_plan_stop rps on rps.id = se.route_plan_stop_id
       join trn.stop s on s.id = rps.stop_id
       join com.location l on l.id = s.location_id`;

export async function listTripStops(tx: Tx, actor: Actor, tripId: string) {
  requirePermission(actor, "trip:read");

  const { rows } = await tx.query(
    `select ${STOP_COLUMNS}, s.window_start as "windowStart", s.window_end as "windowEnd",
            s.contact_name as "contactName", s.contact_phone as "contactPhone",
            s.instructions,
            o.outcome::text as outcome, o.reason as "outcomeReason"
       ${STOP_FROM}
       left join trn.delivery_outcome o on o.stop_execution_id = se.id
      where se.trip_id = $1
      order by se.sequence`,
    [tripId],
  );

  return rows;
}

async function requireStop(tx: Tx, stopExecutionId: string) {
  const { rows } = await tx.query<{
    id: string;
    tripId: string;
    sequence: number;
    status: string;
    kind: string;
    locationName: string;
  }>(`select ${STOP_COLUMNS} ${STOP_FROM} where se.id = $1`, [stopExecutionId]);

  const row = rows[0];
  if (!row) throw notFound("StopExecution");
  return { ...row, status: toStopExecutionState(row.status) };
}

/**
 * Comprueba que quien ejecuta sea el operador asignado.
 *
 * docs/13 §12.5. Un `dispatcher` puede registrar por radio lo que el operador
 * le dicta —es lo que ocurre cuando no hay señal—, pero un `driver` solo toca
 * lo suyo.
 */
async function assertCanExecute(tx: Tx, actor: Actor, tripId: string): Promise<void> {
  if (actor.permissions.has("trip:plan")) return;

  const { rows } = await tx.query<{ mine: boolean }>(
    `select exists (
       select 1 from trn.assignment a
       join cap.driver d on d.id = a.driver_id
       where a.trip_id = $1 and a.status = 'confirmed' and d.user_account_id = $2
     ) as mine`,
    [tripId, actor.userId],
  );

  if (!rows[0]?.mine) {
    // 404 y no 403: revelar que el viaje existe le diría a un operador cuántos
    // viajes lleva la empresa y con qué folios.
    throw notFound("Trip");
  }
}

// ---------------------------------------------------------------------------
// Llegada
// ---------------------------------------------------------------------------

export async function recordStopArrival(
  tx: Tx,
  actor: Actor,
  input: {
    stopExecutionId: string;
    latitude?: string | null;
    longitude?: string | null;
    notes?: string | null;
  },
) {
  requirePermission(actor, "trip:execute");

  const stop = await requireStop(tx, input.stopExecutionId);
  await assertCanExecute(tx, actor, stop.tripId);
  stopExecutionLifecycle.assertTransition(stop.status, "Arrived");

  const trip = await getTrip(tx, actor, stop.tripId);

  await tx.query(
    `update trn.stop_execution
        set status = 'arrived', arrived_at = now(),
            arrival_latitude = $2, arrival_longitude = $3, notes = $4
      where id = $1`,
    [input.stopExecutionId, input.latitude ?? null, input.longitude ?? null, input.notes ?? null],
  );

  // docs/13 §12.1: el viaje avanza a `AtOrigin` en su PRIMERA recolección y a
  // `AtDestination` en su ÚLTIMA entrega. Entre ellas se queda `InTransit`, y
  // el detalle por parada vive en la máquina de la parada.
  const boundary = await stopBoundary(tx, stop.tripId, stop.sequence, stop.kind);

  if (trip.status === "EnRouteToOrigin" && boundary === "first_pickup") {
    tripLifecycle.assertTransition("EnRouteToOrigin", "AtOrigin");
    await advanceTrip(tx, stop.tripId, "at_origin");
  } else if (trip.status === "InTransit" && boundary === "last_delivery") {
    tripLifecycle.assertTransition("InTransit", "AtDestination");
    await advanceTrip(tx, stop.tripId, "at_destination");
  }

  await recordAudit(tx, {
    action: "RecordStopArrival",
    entityType: "StopExecution",
    entityId: input.stopExecutionId,
    after: { status: "Arrived", sequence: stop.sequence },
  });

  await enqueueEvent(tx, {
    eventType: "StopArrived",
    aggregateType: "Trip",
    aggregateId: stop.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: {
      trip_number: trip.tripNumber,
      stop_sequence: stop.sequence,
      stop_kind: stop.kind,
      location: stop.locationName,
    },
  });

  await tx.query(`update trn.trip set event_seq = event_seq + 1 where id = $1`, [stop.tripId]);

  return { ...stop, status: "Arrived" as StopExecutionState };
}

type Boundary = "first_pickup" | "last_delivery" | "intermediate";

async function stopBoundary(
  tx: Tx,
  tripId: string,
  sequence: number,
  kind: string,
): Promise<Boundary> {
  const { rows } = await tx.query<{ firstPickup: number | null; lastDelivery: number | null }>(
    `select min(se.sequence) filter (where s.kind = 'pickup')   as "firstPickup",
            max(se.sequence) filter (where s.kind = 'delivery') as "lastDelivery"
       ${STOP_FROM}
      where se.trip_id = $1`,
    [tripId],
  );

  const bounds = rows[0];
  if (kind === "pickup" && bounds?.firstPickup === sequence) return "first_pickup";
  if (kind === "delivery" && bounds?.lastDelivery === sequence) return "last_delivery";
  return "intermediate";
}

const advanceTrip = (tx: Tx, tripId: string, status: string) =>
  tx.query(`update trn.trip set status = $2::trn.trip_status, revision = revision + 1 where id = $1`, [
    tripId,
    status,
  ]);

// ---------------------------------------------------------------------------
// Desenlace
// ---------------------------------------------------------------------------

const OUTCOME_EVENT: Record<string, string> = {
  completed: "DeliveryCompleted",
  partially_completed: "DeliveryPartiallyCompleted",
  rejected: "DeliveryFailed",
  failed: "DeliveryFailed",
  skipped: "DeliveryFailed",
};

export interface StopOutcomeInput {
  stopExecutionId: string;
  lines: readonly DeliveryLine[];
  reason?: string | null;
  signedBy?: string | null;
}

/**
 * Cierra una parada con sus cantidades.
 *
 * Recorre `Arrived → Servicing → <desenlace>` en una transacción: son
 * transiciones publicadas y ninguna se salta (docs/03 §14.2), pero exigirle al
 * operador un botón de "empezar servicio" y otro de "terminar" solo produciría
 * paradas eternamente en Servicing porque nadie pulsó el segundo.
 */
export async function recordStopOutcome(tx: Tx, actor: Actor, input: StopOutcomeInput) {
  requirePermission(actor, "trip:execute");

  const stop = await requireStop(tx, input.stopExecutionId);
  await assertCanExecute(tx, actor, stop.tripId);

  if (input.lines.length === 0) {
    throw new BosError(
      "invalid_input",
      "outcome_requires_lines",
      "Un desenlace sin cantidades no se puede derivar: el estado saldría de la nada.",
    );
  }

  const violations = validateQuantities(input.lines);
  if (violations.length > 0) {
    throw new BosError(
      "rule_violation",
      "quantities_not_conserved",
      "Las cantidades declaradas no cuadran.",
      violations.map((v) => ({ rule: v.rule, field: v.shipmentItemId, message: v.message })),
    );
  }

  stopExecutionLifecycle.assertTransition(stop.status, "Servicing");
  const outcome = deriveOutcome(stop.kind as "pickup" | "delivery", input.lines);
  const domainState = STOP_STATE_BY_OUTCOME[outcome];
  if (!domainState) {
    // Inalcanzable con los desenlaces que el dominio produce; existe para que
    // añadir uno nuevo sin mapearlo falle aquí y no con un estado vacío en la base.
    throw new BosError(
      "internal",
      "unmapped_delivery_outcome",
      `El desenlace "${outcome}" no tiene estado de parada asignado.`,
    );
  }
  stopExecutionLifecycle.assertTransition("Servicing", domainState);

  if (outcome !== "completed" && !input.reason?.trim()) {
    throw new BosError(
      "invalid_input",
      "outcome_requires_reason",
      "Una entrega incompleta, rechazada o fallida exige motivo: las cantidades dicen qué pasó, no por qué.",
    );
  }

  const trip = await getTrip(tx, actor, stop.tripId);

  await tx.query(
    `update trn.stop_execution
        set status = $2::trn.stop_execution_status, service_started_at = now(), departed_at = now()
      where id = $1`,
    [input.stopExecutionId, STOP_EXECUTION_DB[domainState]],
  );

  const { rows: outcomeRows } = await tx.query<{ id: string }>(
    `insert into trn.delivery_outcome
       (tenant_id, stop_execution_id, outcome, reason, signed_by, recorded_by)
     values ($1,$2,$3::trn.delivery_outcome_kind,$4,$5,$6)
     returning id`,
    [
      tx.context.tenantId,
      input.stopExecutionId,
      outcome,
      input.reason ?? null,
      input.signedBy ?? null,
      actor.userId,
    ],
  );

  const outcomeId = outcomeRows[0]?.id as string;

  for (const line of input.lines) {
    await tx.query(
      `insert into trn.delivery_line
         (tenant_id, delivery_outcome_id, shipment_item_id, uom, planned_quantity,
          loaded_quantity, delivered_quantity, rejected_quantity, damaged_quantity,
          returned_quantity)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tx.context.tenantId,
        outcomeId,
        line.shipmentItemId,
        line.uom,
        line.planned,
        line.loaded,
        line.delivered,
        line.rejected,
        line.damaged,
        line.returned,
      ],
    );
  }

  // Avance del viaje según docs/13 §12.1.
  const boundary = await stopBoundary(tx, stop.tripId, stop.sequence, stop.kind);
  if (trip.status === "AtOrigin" && boundary === "first_pickup") {
    tripLifecycle.assertTransition("AtOrigin", "Loading");
    tripLifecycle.assertTransition("Loading", "InTransit");
    await advanceTrip(tx, stop.tripId, "in_transit");
  } else if (trip.status === "AtDestination" && boundary === "last_delivery") {
    tripLifecycle.assertTransition("AtDestination", "Unloading");
    tripLifecycle.assertTransition("Unloading", "Delivered");
    await tx.query(
      `update trn.trip set status = 'delivered', delivered_at = now(), revision = revision + 1
        where id = $1`,
      [stop.tripId],
    );
    await settleOrder(tx, trip.transportOrderId);
  }

  await recordAudit(tx, {
    action: "RecordStopOutcome",
    entityType: "StopExecution",
    entityId: input.stopExecutionId,
    reason: input.reason ?? null,
    after: { outcome, sequence: stop.sequence },
  });

  await enqueueEvent(tx, {
    eventType: OUTCOME_EVENT[outcome] ?? "DeliveryFailed",
    aggregateType: "Trip",
    aggregateId: stop.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: {
      trip_number: trip.tripNumber,
      stop_sequence: stop.sequence,
      stop_kind: stop.kind,
      outcome,
      reason: input.reason ?? null,
    },
  });

  await tx.query(`update trn.trip set event_seq = event_seq + 1 where id = $1`, [stop.tripId]);

  return { stopExecutionId: input.stopExecutionId, outcome, status: domainState };
}

const STOP_STATE_BY_OUTCOME: Record<string, StopExecutionState> = {
  completed: "Completed",
  partially_completed: "PartiallyCompleted",
  rejected: "Rejected",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * Resuelve la orden cuando todas sus entregas terminaron.
 *
 * `Fulfilled` solo si TODAS quedaron completas; basta una parcial, rechazada o
 * fallida para que sea `PartiallyFulfilled`. Redondear hacia arriba haría que el
 * indicador de cumplimiento midiera intención en lugar de resultado.
 */
async function settleOrder(tx: Tx, orderId: string): Promise<void> {
  const { rows } = await tx.query<{ pending: string; imperfect: string }>(
    `select count(*) filter (where o.outcome is null)::text as pending,
            count(*) filter (where o.outcome is not null and o.outcome <> 'completed')::text as imperfect
       from trn.trip t
       join trn.stop_execution se on se.trip_id = t.id
       join trn.route_plan_stop rps on rps.id = se.route_plan_stop_id
       join trn.stop s on s.id = rps.stop_id and s.kind = 'delivery'
       left join trn.delivery_outcome o on o.stop_execution_id = se.id
      where t.transport_order_id = $1
        and t.status not in ('cancelled','aborted')`,
    [orderId],
  );

  if (Number(rows[0]?.pending ?? 1) > 0) return;

  const status = Number(rows[0]?.imperfect ?? 0) > 0 ? "partially_fulfilled" : "fulfilled";
  await tx.query(
    `update trn.transport_order
        set status = $2::trn.transport_order_status, revision = revision + 1
      where id = $1 and status = 'in_execution'`,
    [orderId, status],
  );
}

// ---------------------------------------------------------------------------
// Cierre operativo
// ---------------------------------------------------------------------------

export async function closeTripOperationally(
  tx: Tx,
  actor: Actor,
  input: { tripId: string; odometerEndKm?: string | null },
) {
  requirePermission(actor, "trip:close");

  const trip = await getTrip(tx, actor, input.tripId);
  tripLifecycle.assertTransition(trip.status, "OperationallyClosed");

  const { rows: stops } = await tx.query<{ sequence: number; resolved: boolean }>(
    `select se.sequence, (o.outcome is not null) as resolved
       from trn.stop_execution se
       left join trn.delivery_outcome o on o.stop_execution_id = se.id
      where se.trip_id = $1
      order by se.sequence`,
    [input.tripId],
  );

  const { rows: evidence } = await tx.query<{ code: string; satisfied: boolean }>(
    `select requirement_code as code, (status <> 'required') as satisfied
       from trn.evidence_requirement
      where trip_id = $1 and is_mandatory`,
    [input.tripId],
  );

  const assessment = assessClosure({ stops, mandatoryEvidence: evidence });

  if (!assessment.canClose) {
    throw new BosError(
      "rule_violation",
      "trip_has_unresolved_stops",
      `No se puede cerrar: la(s) parada(s) ${assessment.unresolvedStops.join(", ")} no tienen desenlace. ` +
        "Eso no es un dato faltante, es una operación sin terminar.",
    );
  }

  // Gastos y combustible son Wave 3: se declaran pendientes en lugar de
  // afirmar que no existen (docs/13 §8).
  const pendingCostItems = ["trip_expenses", "fuel"];

  await tx.query(
    `update trn.trip
        set status = 'operationally_closed', closed_by = $2, closed_at = now(),
            odometer_end_km = $3, completeness = $4, pending_cost_items = $5,
            revision = revision + 1, event_seq = event_seq + 1
      where id = $1`,
    [
      input.tripId,
      actor.userId,
      input.odometerEndKm ?? null,
      assessment.completeness,
      pendingCostItems,
    ],
  );

  await recordAudit(tx, {
    action: "CloseTripOperationally",
    entityType: "Trip",
    entityId: input.tripId,
    after: {
      status: "OperationallyClosed",
      completeness: assessment.completeness,
      pendingEvidence: assessment.pendingEvidence,
      pendingCostItems,
    },
  });

  await enqueueEvent(tx, {
    eventType: "TripOperationallyClosed",
    aggregateType: "Trip",
    aggregateId: input.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: {
      trip_number: trip.tripNumber,
      completeness: assessment.completeness,
      pending_evidence: assessment.pendingEvidence,
      pending_cost_items: pendingCostItems,
    },
  });

  return {
    tripId: input.tripId,
    completeness: assessment.completeness,
    pendingEvidence: assessment.pendingEvidence,
    pendingCostItems,
  };
}
