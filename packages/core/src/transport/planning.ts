import { BosError } from "@fleeter/contracts";
import { requirePermission, type Actor } from "@fleeter/domain";
import { recordAudit, type Tx } from "@fleeter/platform";
import { notFound } from "../shared/command";

/**
 * Carga, paradas y plan de ruta — docs/13 §4 y §5.
 *
 * Es el eslabón entre una orden comprometida y un viaje planeable. La
 * separación que estructura el módulo, y que 0016 documenta en su cabecera:
 *
 *   `trn.stop` es la DEMANDA — el cliente pidió recoger en A y entregar en B.
 *   `trn.route_plan` es la DECISIÓN de planeación sobre esa demanda: en qué
 *   orden, con qué distancia, con qué restricciones.
 *
 * Replanear crea una versión del plan. La demanda no cambia porque el planeador
 * cambie de idea, y por eso vive en otra tabla.
 */

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

export interface ShipmentItemInput {
  lineNumber: number;
  description: string;
  uom: string;
  quantity: string;
  weightKg?: string | null;
}

export async function createShipment(
  tx: Tx,
  actor: Actor,
  input: {
    transportOrderId: string;
    reference?: string | null;
    description?: string | null;
    totalWeightKg?: string | null;
    totalVolumeM3?: string | null;
    totalPieces?: number | null;
    items: readonly ShipmentItemInput[];
  },
) {
  requirePermission(actor, "shipment:write");

  if (input.items.length === 0) {
    throw new BosError(
      "invalid_input",
      "shipment_requires_items",
      "Una carga sin líneas no se puede entregar parcialmente ni contar: el desenlace de cada parada se deriva de ellas.",
    );
  }

  const { rows } = await tx.query<{ id: string }>(
    `insert into trn.shipment
       (tenant_id, transport_order_id, reference, description,
        total_weight_kg, total_volume_m3, total_pieces, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      tx.context.tenantId,
      input.transportOrderId,
      input.reference ?? null,
      input.description ?? null,
      input.totalWeightKg ?? null,
      input.totalVolumeM3 ?? null,
      input.totalPieces ?? null,
      actor.userId,
    ],
  );

  const shipmentId = rows[0]?.id as string;

  for (const item of input.items) {
    await tx.query(
      `insert into trn.shipment_item
         (tenant_id, shipment_id, line_number, description, uom, quantity, weight_kg)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tx.context.tenantId,
        shipmentId,
        item.lineNumber,
        item.description,
        item.uom,
        item.quantity,
        item.weightKg ?? null,
      ],
    );
  }

  await recordAudit(tx, {
    action: "CreateShipment",
    entityType: "Shipment",
    entityId: shipmentId,
    after: { transportOrderId: input.transportOrderId, items: input.items.length },
  });

  return { shipmentId, items: input.items.length };
}

export async function listShipments(tx: Tx, actor: Actor, transportOrderId: string) {
  requirePermission(actor, "shipment:read");

  const { rows } = await tx.query(
    `select s.id, s.reference, s.description,
            s.total_weight_kg as "totalWeightKg", s.total_volume_m3 as "totalVolumeM3",
            s.total_pieces as "totalPieces",
            coalesce(json_agg(json_build_object(
              'id', i.id, 'lineNumber', i.line_number, 'description', i.description,
              'uom', i.uom, 'quantity', i.quantity, 'weightKg', i.weight_kg
            ) order by i.line_number) filter (where i.id is not null), '[]') as items
       from trn.shipment s
       left join trn.shipment_item i on i.shipment_id = s.id
      where s.transport_order_id = $1
      group by s.id
      order by s.created_at`,
    [transportOrderId],
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Paradas
// ---------------------------------------------------------------------------

export interface StopInput {
  kind: "pickup" | "delivery";
  locationId: string;
  sequence: number;
  windowStart?: string | null;
  windowEnd?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  instructions?: string | null;
}

export async function createStops(
  tx: Tx,
  actor: Actor,
  input: { transportOrderId: string; stops: readonly StopInput[] },
) {
  requirePermission(actor, "route_plan:write");

  const kinds = new Set(input.stops.map((s) => s.kind));
  if (!kinds.has("pickup") || !kinds.has("delivery")) {
    throw new BosError(
      "rule_violation",
      "order_requires_pickup_and_delivery",
      "Una orden necesita al menos una recolección y una entrega: sin las dos no hay transporte que ejecutar.",
    );
  }

  const created: string[] = [];

  for (const stop of input.stops) {
    // La zona horaria se copia de la ubicación al crear la parada, igual que
    // 0011 la copia en la solicitud: corregir la ficha mañana no debe mover la
    // ventana que se pactó hoy (docs/03 §14.4).
    const { rows } = await tx.query<{ id: string }>(
      `insert into trn.stop
         (tenant_id, transport_order_id, kind, location_id, timezone,
          window_start, window_end, contact_name, contact_phone, instructions,
          sequence, created_by)
       select $1,$2,$3::trn.stop_kind,$4, l.timezone,$5,$6,$7,$8,
              coalesce($9, l.instructions),$10,$11
         from com.location l where l.id = $4
       returning id`,
      [
        tx.context.tenantId,
        input.transportOrderId,
        stop.kind,
        stop.locationId,
        stop.windowStart ?? null,
        stop.windowEnd ?? null,
        stop.contactName ?? null,
        stop.contactPhone ?? null,
        stop.instructions ?? null,
        stop.sequence,
        actor.userId,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw notFound("Location");
    created.push(id);
  }

  await recordAudit(tx, {
    action: "CreateStops",
    entityType: "TransportOrder",
    entityId: input.transportOrderId,
    after: { stops: created.length },
  });

  return { stopIds: created };
}

/**
 * Crea las dos paradas que la solicitud ya declaró.
 *
 * La Fase 1 capturó origen, destino y ventanas. Volver a pedirlos para planear
 * sería teclear de nuevo un dato que el sistema tiene, y cada retecleo es una
 * oportunidad de que las dos copias difieran.
 */
export async function deriveStopsFromRequest(
  tx: Tx,
  actor: Actor,
  transportOrderId: string,
) {
  requirePermission(actor, "route_plan:write");

  const { rows } = await tx.query<{
    originLocationId: string | null;
    destinationLocationId: string | null;
    pickupWindowStart: string | null;
    pickupWindowEnd: string | null;
    deliveryWindowStart: string | null;
    deliveryWindowEnd: string | null;
  }>(
    `select sr.origin_location_id as "originLocationId",
            sr.destination_location_id as "destinationLocationId",
            sr.pickup_window_start as "pickupWindowStart",
            sr.pickup_window_end as "pickupWindowEnd",
            sr.delivery_window_start as "deliveryWindowStart",
            sr.delivery_window_end as "deliveryWindowEnd"
       from trn.transport_order o
       join trn.service_request sr on sr.id = o.service_request_id
      where o.id = $1`,
    [transportOrderId],
  );

  const request = rows[0];
  if (!request) throw notFound("TransportOrder");

  if (!request.originLocationId || !request.destinationLocationId) {
    throw new BosError(
      "rule_violation",
      "request_missing_locations",
      "La solicitud no tiene origen o destino: no se puede derivar el recorrido de un dato que falta.",
    );
  }

  return createStops(tx, actor, {
    transportOrderId,
    stops: [
      {
        kind: "pickup",
        locationId: request.originLocationId,
        sequence: 1,
        windowStart: request.pickupWindowStart,
        windowEnd: request.pickupWindowEnd,
      },
      {
        kind: "delivery",
        locationId: request.destinationLocationId,
        sequence: 2,
        windowStart: request.deliveryWindowStart,
        windowEnd: request.deliveryWindowEnd,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Plan de ruta
// ---------------------------------------------------------------------------

export async function createRoutePlan(
  tx: Tx,
  actor: Actor,
  input: {
    transportOrderId: string;
    totalDistanceKm?: string | null;
    estimatedDurationMinutes?: number | null;
    restrictions?: Record<string, unknown>;
    notes?: string | null;
    /** Orden de visita. Si se omite, se usa el de la demanda. */
    stopOrder?: readonly { stopId: string; sequence: number }[];
  },
) {
  requirePermission(actor, "route_plan:write");

  const { rows: stops } = await tx.query<{ id: string; sequence: number }>(
    `select id, sequence from trn.stop where transport_order_id = $1 order by sequence`,
    [input.transportOrderId],
  );

  if (stops.length === 0) {
    throw new BosError(
      "rule_violation",
      "order_has_no_stops",
      "La orden no tiene paradas. El plan es una decisión SOBRE la demanda: sin demanda no hay nada que ordenar.",
    );
  }

  const { rows: created } = await tx.query<{ id: string; version: number }>(
    `insert into trn.route_plan
       (tenant_id, transport_order_id, version, total_distance_km,
        estimated_duration_minutes, restrictions, notes, created_by)
     values ($1,$2,
             coalesce((select max(version) from trn.route_plan
                        where transport_order_id = $2), 0) + 1,
             $3,$4,$5,$6,$7)
     returning id, version`,
    [
      tx.context.tenantId,
      input.transportOrderId,
      input.totalDistanceKm ?? null,
      input.estimatedDurationMinutes ?? null,
      JSON.stringify(input.restrictions ?? {}),
      input.notes ?? null,
      actor.userId,
    ],
  );

  const plan = created[0] as { id: string; version: number };
  const order = input.stopOrder ?? stops.map((s) => ({ stopId: s.id, sequence: s.sequence }));

  for (const entry of order) {
    await tx.query(
      `insert into trn.route_plan_stop (tenant_id, route_plan_id, stop_id, sequence)
       values ($1,$2,$3,$4)`,
      [tx.context.tenantId, plan.id, entry.stopId, entry.sequence],
    );
  }

  await recordAudit(tx, {
    action: "CreateRoutePlan",
    entityType: "RoutePlan",
    entityId: plan.id,
    after: {
      transportOrderId: input.transportOrderId,
      version: plan.version,
      stops: order.length,
    },
  });

  return plan;
}

/**
 * Pone una versión en vigor y retira la anterior.
 *
 * Un índice parcial garantiza que solo haya un plan activo por orden: con dos,
 * "la ruta vigente" del gate sería una pregunta sin respuesta.
 */
export async function activateRoutePlan(tx: Tx, actor: Actor, routePlanId: string) {
  requirePermission(actor, "route_plan:write");

  const { rows: found } = await tx.query<{ transportOrderId: string; version: number }>(
    `select transport_order_id as "transportOrderId", version
       from trn.route_plan where id = $1`,
    [routePlanId],
  );

  const plan = found[0];
  if (!plan) throw notFound("RoutePlan");

  await tx.query(
    `update trn.route_plan
        set status = 'superseded', superseded_at = now()
      where transport_order_id = $1 and status = 'active'`,
    [plan.transportOrderId],
  );

  await tx.query(
    `update trn.route_plan
        set status = 'active', activated_by = $2, activated_at = now()
      where id = $1`,
    [routePlanId, actor.userId],
  );

  await recordAudit(tx, {
    action: "ActivateRoutePlan",
    entityType: "RoutePlan",
    entityId: routePlanId,
    after: { status: "active", version: plan.version },
  });

  return { routePlanId, version: plan.version };
}

export async function listRoutePlans(tx: Tx, actor: Actor, transportOrderId: string) {
  requirePermission(actor, "route_plan:read");

  const { rows } = await tx.query(
    `select p.id, p.version, p.status::text as status,
            p.total_distance_km as "totalDistanceKm",
            p.estimated_duration_minutes as "estimatedDurationMinutes",
            p.restrictions, p.notes, p.activated_at as "activatedAt",
            count(ps.id)::int as "stopCount"
       from trn.route_plan p
       left join trn.route_plan_stop ps on ps.route_plan_id = p.id
      where p.transport_order_id = $1
      group by p.id
      order by p.version desc`,
    [transportOrderId],
  );

  return rows;
}
