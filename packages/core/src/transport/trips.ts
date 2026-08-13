import { BosError } from "@fleeter/contracts";
import {
  coversAllCauses,
  evaluateReleaseGate,
  requirePermission,
  tripLifecycle,
  transportOrderLifecycle,
  type Actor,
  type ReleaseCause,
  type TripState,
} from "@fleeter/domain";
import { activeException, enqueueEvent, recordAudit, type Tx } from "@fleeter/platform";
import { resourceFacts } from "../capacity/resources";
import { assertRevision, notFound } from "../shared/command";
import { TRANSPORT_ORDER_DB, TRIP_DB, toTripState } from "../shared/states";

/**
 * Viaje — BC-03, docs/13 §5 y §7.
 *
 * El módulo gira alrededor de una transición: `Confirmed → Released`. Todo lo
 * anterior la prepara y todo lo posterior la asume.
 */

export interface TripRecord {
  id: string;
  legalEntityId: string;
  transportOrderId: string;
  routePlanId: string;
  tripNumber: string;
  status: TripState;
  revision: number;
  eventSeq: number;
  releasedAt: Date | null;
  releaseCauses: string[];
  startedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  completeness: string | null;
}

const TRIP_COLUMNS = `id, legal_entity_id as "legalEntityId",
       transport_order_id as "transportOrderId", route_plan_id as "routePlanId",
       trip_number as "tripNumber", status::text as status, revision,
       event_seq as "eventSeq", released_at as "releasedAt",
       release_causes as "releaseCauses", started_at as "startedAt",
       delivered_at as "deliveredAt", closed_at as "closedAt", completeness`;

type TripRow = Omit<TripRecord, "status"> & { status: string };

const toRecord = (row: TripRow): TripRecord => ({ ...row, status: toTripState(row.status) });

export async function getTrip(tx: Tx, actor: Actor, tripId: string): Promise<TripRecord> {
  requirePermission(actor, "trip:read");

  const { rows } = await tx.query<TripRow>(
    `select ${TRIP_COLUMNS} from trn.trip where id = $1`,
    [tripId],
  );

  const row = rows[0];
  if (!row) throw notFound("Trip");
  return toRecord(row);
}

/**
 * Viajes que el actor puede ver.
 *
 * docs/13 §12.5: `trip:execute` no concede la flota. Un operador ve solo
 * aquellos en los que su propia identidad está asignada y confirmada, y esa
 * restricción vive aquí —en el núcleo— y no en la pantalla: quien tenga la API
 * en la mano alcanza exactamente lo mismo que ve en el navegador.
 */
export async function listTrips(
  tx: Tx,
  actor: Actor,
  options: { onlyMine?: boolean; status?: TripState } = {},
) {
  requirePermission(actor, "trip:read");

  // Quien solo puede ejecutar no elige: siempre ve lo suyo.
  const restrictToOwn =
    options.onlyMine === true ||
    (!actor.permissions.has("trip:plan") && actor.permissions.has("trip:execute"));

  const { rows } = await tx.query(
    // Las columnas se escriben aquí en lugar de derivarse de TRIP_COLUMNS con
    // manipulación de cadenas: prefijar alias por reemplazo es el tipo de truco
    // que funciona hasta que alguien añade una columna con una coma dentro.
    `select t.id, t.trip_number as "tripNumber", t.status::text as status,
            t.revision, t.event_seq as "eventSeq",
            t.transport_order_id as "transportOrderId",
            t.released_at as "releasedAt", t.started_at as "startedAt",
            t.delivered_at as "deliveredAt", t.closed_at as "closedAt",
            o.order_number as "orderNumber",
            c.legal_name as "customerName"
       from trn.trip t
       join trn.transport_order o on o.id = t.transport_order_id
       join com.customer c on c.id = o.customer_id
      where ($2::text is null or t.status::text = $2)
        and (not $3::boolean or exists (
              select 1 from trn.assignment a
              join cap.driver d on d.id = a.driver_id
              where a.trip_id = t.id
                and a.status = 'confirmed'
                and d.user_account_id = $1
            ))
      order by t.created_at desc`,
    [actor.userId, options.status ? TRIP_DB[options.status] : null, restrictToOwn],
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Planear
// ---------------------------------------------------------------------------

/**
 * Crea el viaje contra la versión vigente del plan de ruta.
 *
 * Copia las paradas del plan como ejecuciones pendientes y fija los requisitos
 * de evidencia. Ambas copias son deliberadas (docs/13 §12.7): si el plan se
 * replanea o el perfil de servicio cambia mientras el operador va en camino, lo
 * que se le exige sigue siendo lo que se le comunicó.
 */
export async function planTrip(
  tx: Tx,
  actor: Actor,
  input: { transportOrderId: string; evidenceRequirements?: readonly string[] },
): Promise<TripRecord> {
  requirePermission(actor, "trip:plan");

  const { rows: orders } = await tx.query<{
    id: string;
    legalEntityId: string;
    status: string;
    revision: number;
  }>(
    `select id, legal_entity_id as "legalEntityId", status::text as status, revision
       from trn.transport_order where id = $1`,
    [input.transportOrderId],
  );

  const order = orders[0];
  if (!order) throw notFound("TransportOrder");

  const { rows: plans } = await tx.query<{ id: string; version: number }>(
    `select id, version from trn.route_plan
      where transport_order_id = $1 and status = 'active'`,
    [input.transportOrderId],
  );

  const plan = plans[0];
  if (!plan) {
    throw new BosError(
      "rule_violation",
      "route_plan_not_active",
      "La orden no tiene un plan de ruta vigente. Planear un viaje sin itinerario dejaría al operador sin saber a dónde va.",
    );
  }

  const { rows: planStops } = await tx.query<{ id: string; sequence: number }>(
    `select id, sequence from trn.route_plan_stop
      where route_plan_id = $1 order by sequence`,
    [plan.id],
  );

  if (planStops.length === 0) {
    throw new BosError(
      "rule_violation",
      "route_plan_has_no_stops",
      "El plan de ruta no tiene paradas.",
    );
  }

  const { rows: created } = await tx.query<TripRow>(
    `insert into trn.trip
       (tenant_id, legal_entity_id, transport_order_id, route_plan_id,
        trip_number, status, created_by)
     values ($1,$2,$3,$4, trn.next_trip_number(), 'planned', $5)
     returning ${TRIP_COLUMNS}`,
    [
      tx.context.tenantId,
      order.legalEntityId,
      input.transportOrderId,
      plan.id,
      actor.userId,
    ],
  );

  const trip = toRecord(created[0] as TripRow);

  for (const stop of planStops) {
    await tx.query(
      `insert into trn.stop_execution (tenant_id, trip_id, route_plan_stop_id, sequence)
       values ($1,$2,$3,$4)`,
      [tx.context.tenantId, trip.id, stop.id, stop.sequence],
    );
  }

  for (const code of input.evidenceRequirements ?? []) {
    await tx.query(
      `insert into trn.evidence_requirement (tenant_id, trip_id, requirement_code)
       values ($1,$2,$3)`,
      [tx.context.tenantId, trip.id, code],
    );
  }

  // La orden avanza a Planned. Si ya estaba planeada por otro viaje, se queda
  // como está: una orden con dos viajes sigue estando planeada una sola vez.
  if (order.status === TRANSPORT_ORDER_DB.Committed) {
    transportOrderLifecycle.assertTransition("Committed", "Planned");
    await tx.query(
      `update trn.transport_order set status = 'planned', revision = revision + 1 where id = $1`,
      [order.id],
    );
  }

  await recordAudit(tx, {
    action: "PlanTrip",
    entityType: "Trip",
    entityId: trip.id,
    after: { tripNumber: trip.tripNumber, routePlanId: plan.id, stops: planStops.length },
  });

  await enqueueEvent(tx, {
    eventType: "TripPlanned",
    aggregateType: "Trip",
    aggregateId: trip.id,
    aggregateVersion: 1,
    payload: {
      trip_number: trip.tripNumber,
      transport_order_id: input.transportOrderId,
      route_plan_version: plan.version,
      stops: planStops.length,
    },
  });

  await tx.query(`update trn.trip set event_seq = 1 where id = $1`, [trip.id]);

  return { ...trip, eventSeq: 1 };
}

// ---------------------------------------------------------------------------
// Asignar y confirmar
// ---------------------------------------------------------------------------

export async function assignResources(
  tx: Tx,
  actor: Actor,
  input: {
    tripId: string;
    expectedRevision?: number;
    vehicleId?: string | null;
    trailerId?: string | null;
    driverId?: string | null;
    notes?: string | null;
  },
) {
  requirePermission(actor, "trip:assign");

  const trip = await getTrip(tx, actor, input.tripId);
  if (input.expectedRevision !== undefined) {
    assertRevision("Trip", trip.revision, input.expectedRevision);
  }
  tripLifecycle.assertTransition(trip.status, "Assigned");

  // Reasignar versiona: la anterior queda con su historia y su motivo, y nunca
  // hay dos vigentes que hagan que dos operadores crean que el viaje es suyo.
  await tx.query(
    `update trn.assignment set status = 'superseded', superseded_at = now()
      where trip_id = $1 and status in ('proposed','confirmed')`,
    [input.tripId],
  );

  const { rows } = await tx.query<{ id: string; version: number }>(
    `insert into trn.assignment
       (tenant_id, trip_id, version, vehicle_id, trailer_id, driver_id, assigned_by, notes)
     values ($1,$2,
             coalesce((select max(version) from trn.assignment where trip_id = $2), 0) + 1,
             $3,$4,$5,$6,$7)
     returning id, version`,
    [
      tx.context.tenantId,
      input.tripId,
      input.vehicleId ?? null,
      input.trailerId ?? null,
      input.driverId ?? null,
      actor.userId,
      input.notes ?? null,
    ],
  );

  const assignment = rows[0] as { id: string; version: number };

  await tx.query(
    `update trn.trip set status = 'assigned', revision = revision + 1 where id = $1`,
    [input.tripId],
  );

  await recordAudit(tx, {
    action: "AssignResources",
    entityType: "Trip",
    entityId: input.tripId,
    before: { status: trip.status },
    after: {
      status: "Assigned",
      assignmentVersion: assignment.version,
      vehicleId: input.vehicleId ?? null,
      trailerId: input.trailerId ?? null,
      driverId: input.driverId ?? null,
    },
  });

  await enqueueEvent(tx, {
    eventType: "ResourceAssigned",
    aggregateType: "Trip",
    aggregateId: input.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: {
      trip_number: trip.tripNumber,
      assignment_version: assignment.version,
      vehicle_id: input.vehicleId ?? null,
      trailer_id: input.trailerId ?? null,
      driver_id: input.driverId ?? null,
    },
  });

  await tx.query(`update trn.trip set event_seq = event_seq + 1 where id = $1`, [input.tripId]);

  return { assignmentId: assignment.id, version: assignment.version };
}

export async function confirmAssignment(
  tx: Tx,
  actor: Actor,
  input: { tripId: string; expectedRevision?: number },
) {
  requirePermission(actor, "trip:confirm");

  const trip = await getTrip(tx, actor, input.tripId);
  if (input.expectedRevision !== undefined) {
    assertRevision("Trip", trip.revision, input.expectedRevision);
  }
  tripLifecycle.assertTransition(trip.status, "Confirmed");

  const { rows } = await tx.query<{ id: string; version: number }>(
    `update trn.assignment
        set status = 'confirmed', confirmed_by = $2, confirmed_at = now()
      where trip_id = $1 and status = 'proposed'
      returning id, version`,
    [input.tripId, actor.userId],
  );

  const assignment = rows[0];
  if (!assignment) {
    throw new BosError(
      "rule_violation",
      "no_assignment_to_confirm",
      "No hay una asignación propuesta que confirmar.",
    );
  }

  await tx.query(
    `update trn.trip set status = 'confirmed', revision = revision + 1, event_seq = event_seq + 1
      where id = $1`,
    [input.tripId],
  );

  await recordAudit(tx, {
    action: "ConfirmAssignment",
    entityType: "Trip",
    entityId: input.tripId,
    after: { status: "Confirmed", assignmentVersion: assignment.version },
  });

  await enqueueEvent(tx, {
    eventType: "AssignmentConfirmed",
    aggregateType: "Trip",
    aggregateId: input.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: { trip_number: trip.tripNumber, assignment_version: assignment.version },
  });

  return { assignmentId: assignment.id, version: assignment.version };
}

// ---------------------------------------------------------------------------
// El gate
// ---------------------------------------------------------------------------

/**
 * Reúne los hechos y evalúa el gate. No escribe nada.
 *
 * La usan tanto `GET /release-check` como `releaseTrip`, y esa reutilización es
 * el punto: una consulta que evaluara reglas distintas de las que aplica la
 * liberación sería peor que no tener consulta.
 */
export async function checkReleaseGate(
  tx: Tx,
  actor: Actor,
  tripId: string,
): Promise<{ trip: TripRecord; causes: ReleaseCause[] }> {
  requirePermission(actor, "trip:read");

  const trip = await getTrip(tx, actor, tripId);

  const { rows: context } = await tx.query<{
    orderStatus: string;
    routePlanStatus: string;
    requiredEquipment: string | null;
    shipmentWeightKg: string | null;
  }>(
    `select o.status::text as "orderStatus",
            p.status::text as "routePlanStatus",
            sr.required_equipment as "requiredEquipment",
            (select sum(s.total_weight_kg)::text from trn.shipment s
              where s.transport_order_id = o.id) as "shipmentWeightKg"
       from trn.trip t
       join trn.transport_order o on o.id = t.transport_order_id
       join trn.route_plan p      on p.id = t.route_plan_id
       join trn.service_request sr on sr.id = o.service_request_id
      where t.id = $1`,
    [tripId],
  );

  const ctx = context[0];
  if (!ctx) throw notFound("Trip");

  const { rows: assignments } = await tx.query<{
    status: string;
    vehicleId: string | null;
    trailerId: string | null;
    driverId: string | null;
  }>(
    `select status::text as status, vehicle_id as "vehicleId",
            trailer_id as "trailerId", driver_id as "driverId"
       from trn.assignment
      where trip_id = $1 and status in ('proposed','confirmed')`,
    [tripId],
  );

  const assignment = assignments[0] ?? null;

  const [vehicle, trailer, driver] = await Promise.all([
    resourceFacts(tx, "vehicle", assignment?.vehicleId ?? null),
    resourceFacts(tx, "trailer", assignment?.trailerId ?? null),
    resourceFacts(tx, "driver", assignment?.driverId ?? null),
  ]);

  // Doble reserva: otros viajes del mismo operador que ya salieron y no han
  // cerrado. Sin datos de turno no se puede razonar sobre horarios (docs/13 §6),
  // pero "va manejando otro viaje ahora mismo" sí es verificable.
  let overlapping = 0;
  if (assignment?.driverId) {
    const { rows } = await tx.query<{ count: string }>(
      `select count(*)::text as count
         from trn.trip t
         join trn.assignment a on a.trip_id = t.id and a.status = 'confirmed'
        where t.id <> $1
          and a.driver_id = $2
          and t.status in ('released','en_route_to_origin','at_origin','loading',
                           'in_transit','at_destination','unloading','delivered')`,
      [tripId, assignment.driverId],
    );
    overlapping = Number(rows[0]?.count ?? 0);
  }

  const { rows: stops } = await tx.query<{ sequence: number; hasContact: boolean }>(
    `select se.sequence,
            (s.contact_name is not null and btrim(s.contact_name) <> '') as "hasContact"
       from trn.stop_execution se
       join trn.route_plan_stop rps on rps.id = se.route_plan_stop_id
       join trn.stop s on s.id = rps.stop_id
      where se.trip_id = $1
      order by se.sequence`,
    [tripId],
  );

  const causes = evaluateReleaseGate({
    orderStatus:
      ctx.orderStatus === "planned"
        ? "Planned"
        : ctx.orderStatus === "in_execution"
          ? "InExecution"
          : "Committed",
    routePlanStatus: ctx.routePlanStatus as "draft" | "active" | "superseded" | "discarded",
    assignmentStatus: (assignment?.status ?? null) as
      | "proposed"
      | "confirmed"
      | "superseded"
      | "cancelled"
      | null,
    vehicle,
    trailer,
    driver,
    requiredEquipment: ctx.requiredEquipment,
    shipmentWeightKg: ctx.shipmentWeightKg,
    driverOverlappingTrips: overlapping,
    stops,
  });

  return { trip, causes };
}

export interface ReleaseOutcome {
  released: boolean;
  tripId: string;
  tripNumber: string;
  causes: ReleaseCause[];
  exceptionId?: string | null;
}

/**
 * Libera el viaje, o explica por qué no.
 *
 * Un gate incumplido devuelve `released: false` con las causas y **no** es un
 * error: es la respuesta correcta a una pregunta legítima, igual que docs/12
 * §12.2 resolvió el envío incompleto. Lo que sí es rechazo (422) es pretender
 * liberar con una excepción que no cubre lo que está fallando.
 */
export async function releaseTrip(
  tx: Tx,
  actor: Actor,
  input: { tripId: string; expectedRevision?: number },
): Promise<ReleaseOutcome> {
  requirePermission(actor, "trip:release");

  // Se vuelve a evaluar dentro de la transacción (docs/13 §12.3): entre la
  // consulta y esta línea pudo vencer una credencial o bloquearse una unidad.
  const { trip, causes } = await checkReleaseGate(tx, actor, input.tripId);

  if (input.expectedRevision !== undefined) {
    assertRevision("Trip", trip.revision, input.expectedRevision);
  }
  tripLifecycle.assertTransition(trip.status, "Released");

  let exceptionId: string | null = null;

  if (causes.length > 0) {
    const exception = await activeException(tx, "Trip", input.tripId, "RELEASE_GATE");

    if (!exception) {
      await recordAudit(tx, {
        action: "ReleaseTripBlocked",
        entityType: "Trip",
        entityId: input.tripId,
        reason: "El gate de liberación devolvió causas y no hay excepción vigente",
        authorizationContext: { causes: causes.map((c) => c.code) },
      });

      return {
        released: false,
        tripId: input.tripId,
        tripNumber: trip.tripNumber,
        causes,
      };
    }

    const { rows: covered } = await tx.query<{ coveredCauses: string[] }>(
      `select covered_causes as "coveredCauses" from plt.exception_decision where id = $1`,
      [exception.exceptionId],
    );

    const coverage = coversAllCauses(causes, covered[0]?.coveredCauses ?? []);
    if (!coverage.covered) {
      throw new BosError(
        "rule_violation",
        "exception_does_not_cover_causes",
        `La excepción vigente no autoriza: ${coverage.uncovered.join(", ")}. ` +
          "Quien la concedió firmó por otras causas.",
        coverage.uncovered.map((code) => ({
          rule: "release_gate",
          field: code,
          message: causes.find((c) => c.code === code)?.detail ?? code,
        })),
      );
    }

    exceptionId = exception.exceptionId;
  }

  await tx.query(
    `update trn.trip
        set status = 'released', released_by = $2, released_at = now(),
            release_exception_id = $3, release_causes = $4,
            revision = revision + 1, event_seq = event_seq + 1
      where id = $1`,
    [input.tripId, actor.userId, exceptionId, causes.map((c) => c.code)],
  );

  await recordAudit(tx, {
    action: "ReleaseTrip",
    entityType: "Trip",
    entityId: input.tripId,
    before: { status: trip.status },
    after: { status: "Released", exceptionId },
    // Las causas se conservan aunque estuvieran cubiertas: docs/13 §11.4 exige
    // poder reconstruir contra qué se liberó, y una excepción sin la causa que
    // autorizó no explica nada.
    authorizationContext: { causes: causes.map((c) => c.code), exceptionId },
  });

  await enqueueEvent(tx, {
    eventType: "TripReleased",
    aggregateType: "Trip",
    aggregateId: input.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: {
      trip_number: trip.tripNumber,
      released_with_exception: exceptionId !== null,
      causes: causes.map((c) => c.code),
    },
  });

  return {
    released: true,
    tripId: input.tripId,
    tripNumber: trip.tripNumber,
    causes,
    exceptionId,
  };
}

/** El operador declara salida. La orden pasa a ejecución. */
export async function startTrip(
  tx: Tx,
  actor: Actor,
  input: { tripId: string; odometerKm?: string | null },
): Promise<TripRecord> {
  requirePermission(actor, "trip:execute");

  const trip = await getTrip(tx, actor, input.tripId);
  tripLifecycle.assertTransition(trip.status, "EnRouteToOrigin");

  await tx.query(
    `update trn.trip
        set status = 'en_route_to_origin', started_at = now(), odometer_start_km = $2,
            revision = revision + 1, event_seq = event_seq + 1
      where id = $1`,
    [input.tripId, input.odometerKm ?? null],
  );

  await tx.query(
    `update trn.transport_order set status = 'in_execution', revision = revision + 1
      where id = $1 and status = 'planned'`,
    [trip.transportOrderId],
  );

  await recordAudit(tx, {
    action: "StartTrip",
    entityType: "Trip",
    entityId: input.tripId,
    after: { status: "EnRouteToOrigin", odometerStartKm: input.odometerKm ?? null },
  });

  await enqueueEvent(tx, {
    eventType: "TripStarted",
    aggregateType: "Trip",
    aggregateId: input.tripId,
    aggregateVersion: trip.eventSeq + 1,
    payload: { trip_number: trip.tripNumber },
  });

  return getTrip(tx, actor, input.tripId);
}
