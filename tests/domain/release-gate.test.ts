import { describe, expect, it } from "vitest";
import {
  coversAllCauses,
  evaluateReleaseGate,
  type ReleaseCauseCode,
  type ReleaseGateInput,
  type ResourceFacts,
} from "@fleeter/domain";

/**
 * El gate de docs/03 §4, causa por causa.
 *
 * Cada prueba fija un motivo por el que un viaje NO debe salir. La lista no es
 * burocracia: cada renglón es un camión que llegó a una caseta sin permiso
 * vigente, o una carga que no cabía, o un operador que ya iba manejando otra.
 */

const eligible = (over: Partial<ResourceFacts> = {}): ResourceFacts => ({
  code: "REC-1",
  status: "active",
  invalidCredentials: 0,
  ...over,
});

const readyToRelease = (over: Partial<ReleaseGateInput> = {}): ReleaseGateInput => ({
  orderStatus: "Planned",
  routePlanStatus: "active",
  assignmentStatus: "confirmed",
  vehicle: eligible({ code: "T-101", weightCapacityKg: "24000.000" }),
  trailer: eligible({ code: "R-55", equipmentType: "Caja seca 53" }),
  driver: eligible({ code: "OP-9" }),
  requiredEquipment: "Caja seca 53",
  shipmentWeightKg: "18500.000",
  driverOverlappingTrips: 0,
  stops: [
    { sequence: 1, hasContact: true },
    { sequence: 2, hasContact: true },
  ],
  ...over,
});

const codes = (input: ReleaseGateInput): ReleaseCauseCode[] =>
  evaluateReleaseGate(input).map((c) => c.code);

describe("gate de liberación", () => {
  it("un viaje completo y elegible no devuelve causas", () => {
    expect(evaluateReleaseGate(readyToRelease())).toEqual([]);
  });

  it("credencial vencida detiene la liberación (docs/13 §11.2)", () => {
    const causes = evaluateReleaseGate(
      readyToRelease({
        vehicle: eligible({ code: "T-101", weightCapacityKg: "24000.000", invalidCredentials: 1 }),
      }),
    );

    expect(causes.map((c) => c.code)).toContain("credential_expired");
    expect(causes.find((c) => c.code === "credential_expired")?.detail).toContain("T-101");
  });

  it("sobrepeso compara los números y los muestra (docs/13 §11.3)", () => {
    const causes = evaluateReleaseGate(
      readyToRelease({ shipmentWeightKg: "24000.001" }),
    );

    const exceeded = causes.find((c) => c.code === "capacity_exceeded");
    expect(exceeded).toBeDefined();
    expect(exceeded?.detail).toContain("24000.001");
    expect(exceeded?.detail).toContain("24000.000");
  });

  it("la carga que cabe exactamente cabe", () => {
    // El caso que un double resolvería al azar: 24000.000 kg en 24000.000 kg.
    expect(codes(readyToRelease({ shipmentWeightKg: "24000.000" }))).toEqual([]);
  });

  it("sin capacidad capturada no se afirma nada sobre el peso", () => {
    // Callar es lo correcto: decir que cabe sería inventar, y decir que no
    // cabe detendría viajes legítimos por un dato que nadie llenó.
    expect(codes(readyToRelease({ vehicle: eligible({ code: "T-101" }) }))).toEqual([]);
  });

  it("operador ya asignado a otro viaje liberado (docs/13 §11.6)", () => {
    expect(codes(readyToRelease({ driverOverlappingTrips: 1 }))).toContain("driver_double_booked");
  });

  it("unidad bloqueada dice por qué", () => {
    const causes = evaluateReleaseGate(
      readyToRelease({
        vehicle: eligible({
          code: "T-101",
          status: "blocked",
          blockReason: "Falla de frenos reportada",
        }),
      }),
    );

    const cause = causes.find((c) => c.code === "vehicle_not_eligible");
    expect(cause?.detail).toContain("Falla de frenos reportada");
  });

  it("equipo incompatible no se resuelve adivinando", () => {
    // "Caja seca 53 pies" y "Caja seca 53" se PARECEN. Aceptarlas como iguales
    // abriría la puerta a que una carga refrigerada saliera en caja seca.
    expect(
      codes(readyToRelease({ trailer: eligible({ code: "R-55", equipmentType: "Caja seca 53 pies" }) })),
    ).toContain("equipment_incompatible");
  });

  it("mayúsculas y espacios sí se normalizan", () => {
    expect(
      codes(readyToRelease({ trailer: eligible({ code: "R-55", equipmentType: "  CAJA SECA 53 " }) })),
    ).toEqual([]);
  });

  it("un requisito de equipo sin remolque asignado no se cumple", () => {
    expect(codes(readyToRelease({ trailer: null }))).toContain("equipment_incompatible");
  });

  it("parada sin contacto, con el número de parada", () => {
    const causes = evaluateReleaseGate(
      readyToRelease({
        stops: [
          { sequence: 1, hasContact: true },
          { sequence: 2, hasContact: false },
          { sequence: 3, hasContact: false },
        ],
      }),
    );

    expect(causes.find((c) => c.code === "stop_contact_missing")?.detail).toContain("2, 3");
  });

  it("plan de ruta superado impide liberar", () => {
    expect(codes(readyToRelease({ routePlanStatus: "superseded" }))).toContain(
      "route_plan_not_active",
    );
  });

  it("asignación propuesta pero no confirmada", () => {
    expect(codes(readyToRelease({ assignmentStatus: "proposed" }))).toContain(
      "assignment_not_confirmed",
    );
  });

  it("acumula todas las causas en lugar de detenerse en la primera", () => {
    // Un gate que devolviera solo el primer problema obligaría a liberar,
    // fallar, arreglar y repetir. El planeador merece la lista completa.
    const causes = codes(
      readyToRelease({
        orderStatus: "Committed",
        vehicle: null,
        driver: null,
        stops: [{ sequence: 1, hasContact: false }],
      }),
    );

    expect(causes).toEqual(
      expect.arrayContaining([
        "order_not_committed",
        "vehicle_missing",
        "driver_missing",
        "stop_contact_missing",
      ]),
    );
  });
});

describe("cobertura de la excepción", () => {
  const causes = evaluateReleaseGate(
    readyToRelease({
      vehicle: eligible({ code: "T-101", weightCapacityKg: "24000.000", invalidCredentials: 1 }),
    }),
  );

  it("una excepción que nombra la causa presente autoriza (docs/13 §11.4)", () => {
    expect(coversAllCauses(causes, ["credential_expired"])).toEqual({
      covered: true,
      uncovered: [],
    });
  });

  it("una excepción de otra causa no autoriza (docs/13 §11.5)", () => {
    const coverage = coversAllCauses(causes, ["capacity_exceeded"]);
    expect(coverage.covered).toBe(false);
    expect(coverage.uncovered).toEqual(["credential_expired"]);
  });

  it("una excepción vacía no autoriza nada", () => {
    expect(coversAllCauses(causes, []).covered).toBe(false);
  });

  it("sin causas no hace falta excepción", () => {
    expect(coversAllCauses([], []).covered).toBe(true);
  });
});
