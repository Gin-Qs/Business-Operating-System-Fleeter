import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@fleeter/domain";
import { closePools, grantMembership, withTenantTransaction } from "@fleeter/platform";
import { capacity, commercial, executeCommand, executeQuery, transport } from "@fleeter/core";
import {
  actorFor,
  contextFor,
  hasDatabase,
  provisionTestTenants,
  uniqueCode,
  type TestTenant,
} from "./fixtures";

/**
 * Fase 2 — Orden a Entrega, docs/13 §11.
 *
 * Un caso por criterio de aceptación, contra una base real con RLS activo.
 * El eje es el gate de liberación: casi todo lo demás existe para poder
 * probarlo en condiciones realistas.
 */

const DRIVER_USER_ID = "33333333-3333-4333-8333-333333333333";

describe.skipIf(!hasDatabase)("Fase 2: de la orden a la entrega", () => {
  let alpha: TestTenant;
  let full: Actor;
  let customerId: string;
  let originId: string;
  let destinationId: string;
  let profileId: string;
  let vehicleId: string;
  let trailerId: string;

  const run = <T>(command: string, entityType: string, fn: Parameters<typeof executeCommand<T>>[2]) =>
    executeCommand<T>(full, { command, entityType }, fn).then((o) => o.result);

  const query = <T>(command: string, fn: Parameters<typeof executeQuery<T>>[2]) =>
    executeQuery<T>(full, { command, entityType: "Trip" }, fn);

  /** Orden comprometida lista para planear. */
  const committedOrder = async () => {
    const request = await run<{ id: string }>(
      "CreateServiceRequest",
      "ServiceRequest",
      (tx) =>
        transport.createServiceRequest(tx, full, {
          customerId,
          legalEntityId: alpha.legalEntityId,
          currency: "MXN",
          externalReference: uniqueCode("REF"),
          originLocationId: originId,
          destinationLocationId: destinationId,
          pickupWindowStart: new Date("2026-09-01T14:00:00Z"),
          pickupWindowEnd: new Date("2026-09-01T20:00:00Z"),
          serviceProfileId: profileId,
          commodity: "Abarrotes",
          requiredEquipment: "Caja seca 53",
          cargo: { weight_kg: "18000", pallets: 26 },
        }),
    );

    await run("SubmitServiceRequest", "ServiceRequest", (tx) =>
      transport.submitServiceRequest(tx, full, { requestId: request.id }),
    );

    const detail = await query<{ id: string }>("GetServiceRequest", (tx) =>
      transport.getServiceRequest(tx, full, request.id),
    );

    const quote = await run<{ id: string }>("CreateQuote", "QuoteVersion", (tx) =>
      commercial.createQuote(tx, full, transport.toQuotableRequest(detail as never)),
    );

    await run("CostQuote", "QuoteVersion", (tx) =>
      commercial.costQuote(tx, full, {
        quoteId: quote.id,
        charges: [
          { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "45000.00" },
          { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: "30000.00" },
        ],
        assumptions: { lane: "MTY-QRO" },
      }),
    );
    await run("ApproveQuote", "QuoteVersion", (tx) =>
      commercial.approveQuote(tx, full, { quoteId: quote.id }),
    );
    await run("SendQuote", "QuoteVersion", (tx) =>
      commercial.sendQuote(tx, full, { quoteId: quote.id }),
    );
    await run("AcceptQuote", "QuoteVersion", (tx) =>
      commercial.recordQuoteAcceptance(tx, full, { quoteId: quote.id }),
    );
    await run("AcceptServiceRequest", "ServiceRequest", (tx) =>
      transport.acceptServiceRequest(tx, full, { requestId: request.id }),
    );

    return run<{ id: string }>("CommitTransportOrder", "TransportOrder", (tx) =>
      transport.commitTransportOrder(tx, full, { serviceRequestId: request.id }),
    );
  };

  /** Orden con carga, paradas y plan vigente. */
  const plannableOrder = async (weightKg = "18000.000") => {
    const order = await committedOrder();

    await run("CreateShipment", "Shipment", (tx) =>
      transport.createShipment(tx, full, {
        transportOrderId: order.id,
        totalWeightKg: weightKg,
        items: [
          { lineNumber: 1, description: "Abarrotes surtidos", uom: "TARIMA", quantity: "26" },
        ],
      }),
    );

    await run("CreateStops", "TransportOrder", (tx) =>
      transport.createStops(tx, full, {
        transportOrderId: order.id,
        stops: [
          {
            kind: "pickup",
            locationId: originId,
            sequence: 1,
            windowStart: "2026-09-01T14:00:00Z",
            windowEnd: "2026-09-01T20:00:00Z",
            contactName: "Almacén Monterrey",
            contactPhone: "+52 81 1234 5678",
          },
          {
            kind: "delivery",
            locationId: destinationId,
            sequence: 2,
            contactName: "Recibo CEDIS",
            contactPhone: "+52 442 987 6543",
          },
        ],
      }),
    );

    const plan = await run<{ id: string }>("CreateRoutePlan", "RoutePlan", (tx) =>
      transport.createRoutePlan(tx, full, {
        transportOrderId: order.id,
        totalDistanceKm: "720.500",
      }),
    );

    await run("ActivateRoutePlan", "RoutePlan", (tx) =>
      transport.activateRoutePlan(tx, full, plan.id),
    );

    return order;
  };

  /** Un operador nuevo, sin identidad: para asignar no hace falta. */
  const freshDriver = async () =>
    (
      await run<{ id: string }>("RegisterDriver", "Driver", (tx) =>
        capacity.registerDriver(tx, full, {
          legalEntityId: alpha.legalEntityId,
          code: uniqueCode("OP"),
          fullName: "Operador de prueba",
        }),
      )
    ).id;

  /** Viaje confirmado con los recursos indicados. */
  const confirmedTrip = async (
    resources: { vehicleId?: string; trailerId?: string; driverId?: string } = {},
    weightKg?: string,
  ) => {
    const order = await plannableOrder(weightKg);
    const trip = await run<{ id: string }>("PlanTrip", "Trip", (tx) =>
      transport.planTrip(tx, full, { transportOrderId: order.id, evidenceRequirements: ["POD"] }),
    );

    const assignedDriver = resources.driverId ?? (await freshDriver());

    await run("AssignResources", "Trip", (tx) =>
      transport.assignResources(tx, full, {
        tripId: trip.id,
        vehicleId: resources.vehicleId ?? vehicleId,
        trailerId: resources.trailerId ?? trailerId,
        driverId: assignedDriver,
      }),
    );

    await run("ConfirmAssignment", "Trip", (tx) =>
      transport.confirmAssignment(tx, full, { tripId: trip.id }),
    );

    return { order, trip, driverId: assignedDriver };
  };

  const gate = (tripId: string) =>
    query<{ causes: { code: string; detail: string }[] }>("CheckReleaseGate", (tx) =>
      transport.checkReleaseGate(tx, full, tripId),
    );

  beforeAll(async () => {
    ({ alpha } = await provisionTestTenants());
    full = actorFor(alpha);

    // El operador necesita identidad en el tenant: sin ella `cap.driver` no
    // puede referenciarla, y sin el vínculo no podría ejecutar su propio viaje.
    await withTenantTransaction(contextFor(alpha), (tx) =>
      grantMembership(tx, {
        userId: DRIVER_USER_ID,
        email: "alpha.auditor@fleeter.test",
        fullName: "Operador Alpha",
        roleCode: "driver",
      }),
    );

    const customer = await run<{ id: string }>("CreateCustomer", "Customer", (tx) =>
      commercial.createCustomer(tx, full, {
        code: uniqueCode("CLI"),
        legalName: "Distribuidora del Bajío S.A. de C.V.",
        operatingCurrency: "MXN",
        status: "active",
        legalEntityId: alpha.legalEntityId,
      }),
    );
    customerId = customer.id;

    const [origin, destination] = await Promise.all([
      run<{ id: string }>("CreateLocation", "Location", (tx) =>
        commercial.createLocation(tx, full, {
          code: uniqueCode("ORI"),
          name: "Planta Monterrey",
          addressLine: "Av. Industrial 100",
          city: "Monterrey",
          country: "MX",
          timezone: "America/Monterrey",
          customerId: customer.id,
          instructions: "Entrada por andén norte",
        }),
      ),
      run<{ id: string }>("CreateLocation", "Location", (tx) =>
        commercial.createLocation(tx, full, {
          code: uniqueCode("DES"),
          name: "CEDIS Querétaro",
          addressLine: "Parque Logístico 5",
          city: "Querétaro",
          country: "MX",
          timezone: "America/Mexico_City",
          customerId: customer.id,
          instructions: "Cita obligatoria",
        }),
      ),
    ]);
    originId = origin.id;
    destinationId = destination.id;

    const profile = await run<{ id: string }>("CreateServiceProfile", "ServiceProfile", (tx) =>
      commercial.publishServiceProfile(tx, full, {
        code: uniqueCode("PERF"),
        serviceType: "FTL",
        equipmentType: "Caja seca 53",
        commodity: "Abarrotes",
        customerId: customer.id,
        requirements: { evidence: ["POD"] },
      }),
    );
    profileId = profile.id;

    await run("SetCreditLimit", "CreditProfile", (tx) =>
      commercial.setCreditLimit(tx, full, {
        customerId: customer.id,
        legalEntityId: alpha.legalEntityId,
        currency: "MXN",
        creditLimit: "5000000.00",
      }),
    );

    // Flota elegible: activa y con credenciales vigentes.
    const vehicle = await run<{ id: string }>("RegisterVehicle", "Vehicle", (tx) =>
      capacity.registerVehicle(tx, full, {
        legalEntityId: alpha.legalEntityId,
        code: uniqueCode("T"),
        plate: uniqueCode("PL"),
        vehicleType: "Tractocamión",
        weightCapacityKg: "24000.000",
      }),
    );
    vehicleId = vehicle.id;

    const trailer = await run<{ id: string }>("RegisterTrailer", "TrailerEquipment", (tx) =>
      capacity.registerTrailer(tx, full, {
        legalEntityId: alpha.legalEntityId,
        code: uniqueCode("R"),
        equipmentType: "Caja seca 53",
        weightCapacityKg: "24000.000",
      }),
    );
    trailerId = trailer.id;

    for (const [subjectType, subjectId] of [
      ["vehicle", vehicleId],
      ["trailer", trailerId],
    ] as const) {
      await run("RecordCredential", "Credential", (tx) =>
        capacity.recordCredential(tx, full, {
          subjectType,
          subjectId,
          credentialType: "SEGURO",
          expiresOn: "2027-12-31",
        }),
      );
    }
  });

  afterAll(async () => {
    await closePools();
  });

  // -------------------------------------------------------------------------

  it("§11.2 — una credencial vencida impide liberar y no emite TripReleased", async () => {
    const trip0 = await confirmedTrip();
    const trip = trip0.trip;

    // La licencia del operador de ESTE viaje venció hace años.
    await run("RecordCredential", "Credential", (tx) =>
      capacity.recordCredential(tx, full, {
        subjectType: "driver",
        subjectId: trip0.driverId,
        credentialType: "LICENCIA",
        expiresOn: "2020-01-01",
      }),
    );

    const outcome = await run<{ released: boolean; causes: { code: string }[] }>(
      "ReleaseTrip",
      "Trip",
      (tx) => transport.releaseTrip(tx, full, { tripId: trip.id }),
    );

    expect(outcome.released).toBe(false);
    expect(outcome.causes.map((c) => c.code)).toContain("credential_expired");

    const events = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `select count(*)::text as count from plt.outbox
          where aggregate_id = $1 and event_type = 'TripReleased'`,
        [trip.id],
      );
      return Number(rows[0]!.count);
    });
    expect(events).toBe(0);

  });

  it("§11.3 — el sobrepeso aparece con el peso y la capacidad comparados", async () => {
    const { trip } = await confirmedTrip({}, "30000.000");
    const { causes } = await gate(trip.id);

    const exceeded = causes.find((c) => c.code === "capacity_exceeded");
    expect(exceeded).toBeDefined();
    expect(exceeded?.detail).toContain("30000.000");
    expect(exceeded?.detail).toContain("24000.000");
  });

  it("un recurso bloqueado deja de ser elegible sin que nadie lo marque", async () => {
    const { trip } = await confirmedTrip();

    await run("BlockResource", "Vehicle", (tx) =>
      capacity.blockResource(tx, full, {
        kind: "vehicle",
        resourceId: vehicleId,
        reason: "Falla de frenos reportada en inspección",
      }),
    );

    const { causes } = await gate(trip.id);
    expect(causes.map((c) => c.code)).toContain("vehicle_not_eligible");
    expect(causes.find((c) => c.code === "vehicle_not_eligible")?.detail).toContain("frenos");

    await run("ReleaseResource", "Vehicle", (tx) =>
      capacity.releaseResource(tx, full, { kind: "vehicle", resourceId: vehicleId }),
    );

    const after = await gate(trip.id);
    expect(after.causes.map((c) => c.code)).not.toContain("vehicle_not_eligible");
  });

  it("§11.7 — 26 planeadas y 20 entregadas dan PartiallyCompleted sin que nadie lo elija", async () => {
    const { order, trip } = await confirmedTrip();

    await run("ReleaseTrip", "Trip", (tx) =>
      transport.releaseTrip(tx, full, { tripId: trip.id }),
    );
    await run("StartTrip", "Trip", (tx) =>
      transport.startTrip(tx, full, { tripId: trip.id, odometerKm: "100000.000" }),
    );

    const stops = await query<{ id: string; sequence: number; kind: string }[]>(
      "ListTripStops",
      (tx) => transport.listTripStops(tx, full, trip.id) as never,
    );

    const shipments = await query<{ items: { id: string }[] }[]>("ListShipments", (tx) =>
      transport.listShipments(tx, full, order.id) as never,
    );
    const itemId = shipments[0]!.items[0]!.id;

    const pickup = stops.find((s) => s.kind === "pickup")!;
    const delivery = stops.find((s) => s.kind === "delivery")!;

    await run("RecordStopArrival", "StopExecution", (tx) =>
      transport.recordStopArrival(tx, full, { stopExecutionId: pickup.id }),
    );
    await run("RecordStopOutcome", "StopExecution", (tx) =>
      transport.recordStopOutcome(tx, full, {
        stopExecutionId: pickup.id,
        lines: [
          {
            shipmentItemId: itemId,
            uom: "TARIMA",
            planned: "26",
            loaded: "26",
            delivered: "0",
            rejected: "0",
            damaged: "0",
            returned: "0",
          },
        ],
      }),
    );

    await run("RecordStopArrival", "StopExecution", (tx) =>
      transport.recordStopArrival(tx, full, { stopExecutionId: delivery.id }),
    );

    const result = await run<{ outcome: string }>("RecordStopOutcome", "StopExecution", (tx) =>
      transport.recordStopOutcome(tx, full, {
        stopExecutionId: delivery.id,
        reason: "El CEDIS rechazó 6 tarimas por daño en el embalaje",
        lines: [
          {
            shipmentItemId: itemId,
            uom: "TARIMA",
            planned: "26",
            loaded: "26",
            delivered: "20",
            rejected: "6",
            damaged: "0",
            returned: "0",
          },
        ],
      }),
    );

    expect(result.outcome).toBe("partially_completed");

    const events = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ eventType: string }>(
        `select event_type as "eventType" from plt.outbox where aggregate_id = $1`,
        [trip.id],
      );
      return rows.map((r) => r.eventType);
    });
    expect(events).toContain("DeliveryPartiallyCompleted");

    // Y la orden quedó parcialmente cumplida, no cumplida.
    const orderState = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `select status::text as status from trn.transport_order where id = $1`,
        [order.id],
      );
      return rows[0]!.status;
    });
    expect(orderState).toBe("partially_fulfilled");
  });

  it("§11.9 — no se cierra un viaje sin entregar; con evidencia pendiente sí, y lo declara", async () => {
    const { order, trip } = await confirmedTrip();

    await run("ReleaseTrip", "Trip", (tx) =>
      transport.releaseTrip(tx, full, { tripId: trip.id }),
    );
    await run("StartTrip", "Trip", (tx) => transport.startTrip(tx, full, { tripId: trip.id }));

    // Sin entregar, cerrar es imposible: el ciclo de vida lo impide antes que
    // cualquier regla de completitud. (El caso de una parada intermedia sin
    // desenlace lo cubre `assessClosure` en las pruebas de dominio.)
    await expect(
      run("CloseTripOperationally", "Trip", (tx) =>
        transport.closeTripOperationally(tx, full, { tripId: trip.id }),
      ),
    ).rejects.toThrow(/no puede pasar/);

    const stops = await query<{ id: string; kind: string }[]>("ListTripStops", (tx) =>
      transport.listTripStops(tx, full, trip.id) as never,
    );
    const shipments = await query<{ items: { id: string }[] }[]>("ListShipments", (tx) =>
      transport.listShipments(tx, full, order.id) as never,
    );
    const itemId = shipments[0]!.items[0]!.id;

    const full26 = (delivered: string) => [
      {
        shipmentItemId: itemId,
        uom: "TARIMA",
        planned: "26",
        loaded: "26",
        delivered,
        rejected: "0",
        damaged: "0",
        returned: "0",
      },
    ];

    for (const stop of stops) {
      await run("RecordStopArrival", "StopExecution", (tx) =>
        transport.recordStopArrival(tx, full, { stopExecutionId: stop.id }),
      );
      await run("RecordStopOutcome", "StopExecution", (tx) =>
        transport.recordStopOutcome(tx, full, {
          stopExecutionId: stop.id,
          lines: full26(stop.kind === "pickup" ? "0" : "26"),
        }),
      );
    }

    // El POD sigue sin validarse. Cerrar es legítimo, pero el viaje lo declara:
    // docs/09 §13 permite el cierre provisional siempre que muestre qué falta.
    const closed = await run<{ completeness: string; pendingEvidence: string[]; pendingCostItems: string[] }>(
      "CloseTripOperationally",
      "Trip",
      (tx) => transport.closeTripOperationally(tx, full, { tripId: trip.id }),
    );

    expect(closed.completeness).toBe("0");
    expect(closed.pendingEvidence).toEqual(["POD"]);
    // Gastos y combustible son Wave 3: se declaran pendientes, no inexistentes.
    expect(closed.pendingCostItems).toContain("fuel");
  });

  it("un viaje liberado ocupa al operador y el siguiente lo detecta", async () => {
    const shared = await freshDriver();
    await run("RecordCredential", "Credential", (tx) =>
      capacity.recordCredential(tx, full, {
        subjectType: "driver",
        subjectId: shared,
        credentialType: "LICENCIA",
        expiresOn: "2027-12-31",
      }),
    );

    const first = await confirmedTrip({ driverId: shared });
    const released = await run<{ released: boolean }>("ReleaseTrip", "Trip", (tx) =>
      transport.releaseTrip(tx, full, { tripId: first.trip.id }),
    );
    expect(released.released).toBe(true);

    const second = await confirmedTrip({ driverId: shared });
    const { causes } = await gate(second.trip.id);

    expect(causes.map((c) => c.code)).toContain("driver_double_booked");
  });
});
