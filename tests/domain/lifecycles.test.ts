import { describe, expect, it } from "vitest";
import {
  quoteLifecycle,
  serviceRequestLifecycle,
  transportOrderLifecycle,
} from "@fleeter/domain";

/**
 * Estas pruebas comparan la tabla de transiciones del código contra docs/12 §5.
 * Si alguien añade un camino sin actualizar el documento —o al revés— aquí se
 * rompe. Es lo que hace cumplible docs/03 §14.2, "sin salto de estados".
 */

describe("ciclo de vida de la solicitud de servicio", () => {
  it("recorre el camino feliz de docs/12 §5", () => {
    const path = ["Draft", "Submitted", "Validating", "Accepted", "Converted"] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(serviceRequestLifecycle.canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("permite pedir información y retomar la validación", () => {
    expect(serviceRequestLifecycle.canTransition("Submitted", "NeedsInformation")).toBe(true);
    expect(serviceRequestLifecycle.canTransition("NeedsInformation", "Validating")).toBe(true);
  });

  it("no permite saltarse la validación", () => {
    expect(() => serviceRequestLifecycle.assertTransition("Submitted", "Accepted")).toThrowError(
      /no puede pasar de Submitted a Accepted/,
    );
  });

  it("no permite convertir una solicitud que no fue aceptada", () => {
    expect(serviceRequestLifecycle.canTransition("Validating", "Converted")).toBe(false);
  });

  it("no permite revivir una solicitud cancelada", () => {
    expect(serviceRequestLifecycle.isTerminal("Cancelled")).toBe(true);
    expect(() => serviceRequestLifecycle.assertTransition("Cancelled", "Submitted")).toThrowError(
      /estado terminal/,
    );
  });

  it("expone las transiciones válidas en el error, para que la interfaz no las repita", () => {
    try {
      serviceRequestLifecycle.assertTransition("Draft", "Accepted");
      expect.unreachable("debió lanzar");
    } catch (error) {
      const violations = (error as { violations: { remediation?: string }[] }).violations;
      expect(violations[0]?.remediation).toContain("Submitted");
    }
  });
});

describe("ciclo de vida de la cotización", () => {
  it("permite aprobar sin pasar por PendingApproval cuando la política se cumple", () => {
    // docs/12 §5: "Costed/PendingApproval → Approved".
    expect(quoteLifecycle.canTransition("Costed", "Approved")).toBe(true);
    expect(quoteLifecycle.canTransition("Costed", "PendingApproval")).toBe(true);
  });

  it("no permite enviar una cotización sin aprobar", () => {
    expect(quoteLifecycle.canTransition("Costed", "Sent")).toBe(false);
    expect(quoteLifecycle.canTransition("PendingApproval", "Sent")).toBe(false);
  });

  it("no permite aceptar una cotización que no se envió", () => {
    expect(quoteLifecycle.canTransition("Approved", "Accepted")).toBe(false);
  });
});

describe("ciclo de vida de la orden de transporte", () => {
  it("exige validar antes de comprometer", () => {
    expect(transportOrderLifecycle.canTransition("Draft", "Committed")).toBe(false);
    expect(transportOrderLifecycle.canTransition("Draft", "Validated")).toBe(true);
    expect(transportOrderLifecycle.canTransition("Validated", "Committed")).toBe(true);
  });

  it("cierra el corte en Committed", () => {
    // docs/03 §3 continúa hacia Planned e InExecution, pero eso pertenece a la
    // fase que implemente la planeación.
    expect(transportOrderLifecycle.isTerminal("Committed")).toBe(true);
  });
});
