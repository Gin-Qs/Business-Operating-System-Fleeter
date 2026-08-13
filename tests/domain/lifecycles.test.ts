import { describe, expect, it } from "vitest";
import {
  countsInWinRate,
  evidenceSubmissionLifecycle,
  isStopResolved,
  occupiesResources,
  quoteLifecycle,
  serviceRequestLifecycle,
  stopExecutionLifecycle,
  STOP_RESOLVED_STATES,
  transportOrderLifecycle,
  tripLifecycle,
  TRIP_PRE_RELEASE_STATES,
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

  describe("los dos rechazos son hechos distintos", () => {
    // docs/03 §7. La distinción no es cosmética: COM-001 define win rate como
    // aceptadas / (aceptadas + rechazadas), y una versión que el cliente nunca
    // vio no puede contar como derrota comercial.

    it("el aprobador interno rechaza desde PendingApproval", () => {
      expect(quoteLifecycle.canTransition("PendingApproval", "ChangesRequested")).toBe(true);
    });

    it("el cliente solo puede rechazar lo que se le envió", () => {
      expect(quoteLifecycle.canTransition("Sent", "Rejected")).toBe(true);
      expect(quoteLifecycle.canTransition("PendingApproval", "Rejected")).toBe(false);
      expect(quoteLifecycle.canTransition("Costed", "Rejected")).toBe(false);
      expect(quoteLifecycle.canTransition("Approved", "Rejected")).toBe(false);
    });

    it("el aprobador no puede rechazar algo que ya salió al cliente", () => {
      expect(quoteLifecycle.canTransition("Sent", "ChangesRequested")).toBe(false);
      expect(quoteLifecycle.canTransition("Approved", "ChangesRequested")).toBe(false);
    });

    it("solo el rechazo del cliente cuenta en el win rate", () => {
      expect(countsInWinRate("Accepted")).toBe(true);
      expect(countsInWinRate("Rejected")).toBe(true);
      // Si esto fuera true, el KPI reportaría una tasa de éxito peor que la
      // real cada vez que pricing tuviera que recostear.
      expect(countsInWinRate("ChangesRequested")).toBe(false);
      expect(countsInWinRate("PendingApproval")).toBe(false);
    });

    it("ambos rechazos son terminales: recostear crea una versión nueva", () => {
      // docs/02 §BC-02: cada cotización referencia una versión inmutable de
      // costos y supuestos, así que no se vuelve a Costed sobre la misma.
      expect(quoteLifecycle.isTerminal("ChangesRequested")).toBe(true);
      expect(quoteLifecycle.isTerminal("Rejected")).toBe(true);
      expect(() => quoteLifecycle.assertTransition("ChangesRequested", "Costed")).toThrowError(
        /estado terminal/,
      );
    });
  });
});

describe("ciclo de vida de la orden de transporte", () => {
  it("exige validar antes de comprometer", () => {
    expect(transportOrderLifecycle.canTransition("Draft", "Committed")).toBe(false);
    expect(transportOrderLifecycle.canTransition("Draft", "Validated")).toBe(true);
    expect(transportOrderLifecycle.canTransition("Validated", "Committed")).toBe(true);
  });

  it("comprometer habilita planear, y no saltar a ejecución", () => {
    // La Fase 1 dejaba `Committed` terminal porque la planeación no existía.
    // Con Fase 2 continúa, pero el orden de docs/03 §3 se respeta: no se
    // ejecuta lo que no se planeó.
    expect(transportOrderLifecycle.canTransition("Committed", "Planned")).toBe(true);
    expect(transportOrderLifecycle.canTransition("Committed", "InExecution")).toBe(false);
    expect(transportOrderLifecycle.canTransition("Planned", "InExecution")).toBe(true);
  });

  it("una orden en ejecución ya no se cancela", () => {
    // Cancelar con carga en la calle no es una transición de estado: es una
    // operación que hay que abortar y explicar.
    expect(transportOrderLifecycle.canTransition("InExecution", "Cancelled")).toBe(false);
    expect(transportOrderLifecycle.canTransition("Committed", "Cancelled")).toBe(true);
    expect(transportOrderLifecycle.canTransition("Planned", "Cancelled")).toBe(true);
  });

  it("los desenlaces son terminales", () => {
    // docs/03 §3 continúa hacia FinanciallyClosed, que es un resumen financiero
    // de la fase que implemente facturación.
    expect(transportOrderLifecycle.isTerminal("Fulfilled")).toBe(true);
    expect(transportOrderLifecycle.isTerminal("PartiallyFulfilled")).toBe(true);
    expect(transportOrderLifecycle.isTerminal("Cancelled")).toBe(true);
  });
});

describe("ciclo de vida del viaje — docs/03 §4", () => {
  it("no se libera sin confirmar la asignación", () => {
    expect(tripLifecycle.canTransition("Assigned", "Released")).toBe(false);
    expect(tripLifecycle.canTransition("Confirmed", "Released")).toBe(true);
  });

  it("reasignar es legítimo antes de liberar y no después", () => {
    expect(tripLifecycle.canTransition("Confirmed", "Assigned")).toBe(true);
    expect(tripLifecycle.canTransition("Released", "Assigned")).toBe(false);
  });

  it("cancelar solo antes de comprometer recursos; después se aborta", () => {
    for (const state of TRIP_PRE_RELEASE_STATES) {
      expect(tripLifecycle.canTransition(state, "Cancelled")).toBe(true);
    }
    expect(tripLifecycle.canTransition("InTransit", "Cancelled")).toBe(false);
    expect(tripLifecycle.canTransition("InTransit", "Aborted")).toBe(true);
  });

  it("un viaje liberado ocupa recursos y uno planeado no", () => {
    expect(occupiesResources("Planned")).toBe(false);
    expect(occupiesResources("Released")).toBe(true);
    expect(occupiesResources("InTransit")).toBe(true);
    expect(occupiesResources("OperationallyClosed")).toBe(false);
  });

  it("no se cierra un viaje que no fue entregado", () => {
    expect(tripLifecycle.canTransition("InTransit", "OperationallyClosed")).toBe(false);
    expect(tripLifecycle.canTransition("Delivered", "OperationallyClosed")).toBe(true);
  });
});

describe("ciclo de vida de la parada — docs/03 §5", () => {
  it("no se sirve una parada a la que no se llegó", () => {
    expect(stopExecutionLifecycle.canTransition("Pending", "Servicing")).toBe(false);
    expect(stopExecutionLifecycle.canTransition("Arrived", "Servicing")).toBe(true);
  });

  it("omitir una parada se decide antes de llegar", () => {
    expect(stopExecutionLifecycle.canTransition("Pending", "Skipped")).toBe(true);
    expect(stopExecutionLifecycle.canTransition("Servicing", "Skipped")).toBe(false);
  });

  it("todo desenlace es terminal y cuenta como resuelto", () => {
    for (const state of STOP_RESOLVED_STATES) {
      expect(stopExecutionLifecycle.isTerminal(state)).toBe(true);
      expect(isStopResolved(state)).toBe(true);
    }
    expect(isStopResolved("Servicing")).toBe(false);
  });
});

describe("ciclo de vida de la evidencia — docs/03 §6", () => {
  it("una aceptada no se reabre: corregir exige una presentación nueva", () => {
    expect(evidenceSubmissionLifecycle.isTerminal("Accepted")).toBe(true);
    expect(evidenceSubmissionLifecycle.canTransition("Accepted", "Validating")).toBe(false);
  });

  it("una rechazada tampoco se reabre; el reenvío es otra presentación", () => {
    expect(evidenceSubmissionLifecycle.isTerminal("Rejected")).toBe(true);
  });
});
