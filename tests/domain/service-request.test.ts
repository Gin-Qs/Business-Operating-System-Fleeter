import { describe, expect, it } from "vitest";
import {
  causesToViolations,
  isServiceRequestComplete,
  serviceRequestGaps,
  type ServiceRequestDraft,
} from "@fleeter/domain";

/**
 * Completitud de la solicitud — docs/12 §5 y §9.2.
 *
 * La regla decide si una solicitud puede enviarse y, cuando no, POR QUÉ. Lo
 * segundo importa tanto como lo primero: docs/12 §9.2 exige que la solicitud
 * quede en `NeedsInformation` con la causa, no rechazada sin más.
 */

const complete = (overrides: Partial<ServiceRequestDraft> = {}): ServiceRequestDraft => ({
  customerId: "c0000000-0000-4000-8000-000000000001",
  externalReference: "PO-99321",
  originLocationId: "10000000-0000-4000-8000-000000000001",
  destinationLocationId: "20000000-0000-4000-8000-000000000002",
  pickupWindow: {
    start: new Date("2026-09-01T14:00:00Z"),
    end: new Date("2026-09-01T20:00:00Z"),
  },
  deliveryWindow: { start: null, end: null },
  commodity: "Abarrotes",
  requiredEquipment: "Caja seca 53",
  ...overrides,
});

describe("completitud de la solicitud de servicio", () => {
  it("una solicitud con los datos de docs/12 §5 puede enviarse", () => {
    expect(serviceRequestGaps(complete())).toEqual([]);
    expect(isServiceRequestComplete(complete())).toBe(true);
  });

  it("sin origen devuelve exactamente la causa origin_required", () => {
    // El nombre de la causa es contrato: docs/12 §9.2 lo escribe literalmente y
    // la telemetría de §10 cuenta solicitudes por él.
    expect(serviceRequestGaps(complete({ originLocationId: null }))).toEqual(["origin_required"]);
  });

  it("acumula todas las causas en lugar de detenerse en la primera", () => {
    // Devolver una solicitud siete veces seguidas, una por dato faltante, es la
    // forma más rápida de que nadie vuelva a usar el sistema.
    const causes = serviceRequestGaps(
      complete({
        originLocationId: null,
        destinationLocationId: null,
        commodity: "   ",
        requiredEquipment: null,
      }),
    );

    expect(causes).toEqual([
      "origin_required",
      "destination_required",
      "commodity_required",
      "equipment_required",
    ]);
  });

  it("basta una ventana completa, de carga o de entrega", () => {
    // docs/03 §2 y docs/12 §5 dicen "ventana", en singular. "Recoge cuando
    // puedas, entrega antes del viernes" es una solicitud legítima.
    const soloEntrega = complete({
      pickupWindow: { start: null, end: null },
      deliveryWindow: {
        start: new Date("2026-09-03T08:00:00Z"),
        end: new Date("2026-09-03T18:00:00Z"),
      },
    });

    expect(serviceRequestGaps(soloEntrega)).toEqual([]);
  });

  it("una ventana a medias no es una ventana", () => {
    const sinFin = complete({
      pickupWindow: { start: new Date("2026-09-01T14:00:00Z"), end: null },
    });

    expect(serviceRequestGaps(sinFin)).toContain("time_window_required");
  });

  it("detecta inconsistencias, no solo faltantes", () => {
    // docs/12 §5: "Falta un dato o existe inconsistencia; registra la causa."
    const invertida = complete({
      pickupWindow: {
        start: new Date("2026-09-01T20:00:00Z"),
        end: new Date("2026-09-01T14:00:00Z"),
      },
    });

    expect(serviceRequestGaps(invertida)).toContain("window_end_before_start");

    const entregaAntes = complete({
      deliveryWindow: {
        start: new Date("2026-08-30T08:00:00Z"),
        end: new Date("2026-08-30T18:00:00Z"),
      },
    });

    expect(serviceRequestGaps(entregaAntes)).toContain("delivery_before_pickup");
  });

  it("una cadena en blanco no cuenta como dato capturado", () => {
    expect(serviceRequestGaps(complete({ externalReference: "   " }))).toEqual([
      "external_reference_required",
    ]);
  });

  it("cada causa se traduce a una instrucción concreta, no a un código suelto", () => {
    const violations = causesToViolations(["origin_required", "commodity_required"]);

    expect(violations[0]).toMatchObject({
      rule: "ORIGIN_REQUIRED",
      field: "origin_location_id",
    });
    expect(violations[0]?.remediation).toMatch(/origen/i);
    expect(violations[1]?.remediation).toMatch(/mercancía/i);
  });
});
