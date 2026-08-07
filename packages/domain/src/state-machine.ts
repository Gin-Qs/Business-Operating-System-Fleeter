import { BosError } from "@fleeter/contracts";

/**
 * Máquina de estados declarativa — docs/03.
 *
 * docs/03 §14.2 prohíbe los saltos de estado: solo se ejecutan transiciones
 * publicadas. Declararlas como dato en lugar de como `if` dispersos permite que
 * la tabla de transiciones sea exactamente lo que dice el documento, y que una
 * prueba compare ambas.
 */

export interface StateMachineDefinition<S extends string> {
  /** Nombre del agregado, usado para construir códigos de error estables. */
  readonly name: string;
  readonly initial: S;
  /** Estado → estados alcanzables desde él. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  /** Estados sin salida. Ninguna transición puede partir de ellos. */
  readonly terminal: readonly S[];
}

export class StateMachine<S extends string> {
  private readonly errorCode: string;

  constructor(private readonly definition: StateMachineDefinition<S>) {
    this.errorCode = `${screamingSnake(definition.name)}_TRANSITION_NOT_ALLOWED`;

    for (const state of definition.terminal) {
      const outgoing = definition.transitions[state];
      if (outgoing && outgoing.length > 0) {
        throw new Error(
          `${definition.name}: el estado terminal ${state} declara transiciones de salida`,
        );
      }
    }
  }

  get name(): string {
    return this.definition.name;
  }

  get initial(): S {
    return this.definition.initial;
  }

  states(): S[] {
    return Object.keys(this.definition.transitions) as S[];
  }

  isTerminal(state: S): boolean {
    return this.definition.terminal.includes(state);
  }

  nextStates(from: S): readonly S[] {
    return this.definition.transitions[from] ?? [];
  }

  canTransition(from: S, to: S): boolean {
    return this.nextStates(from).includes(to);
  }

  /**
   * Verifica la transición o lanza un error de negocio con código estable.
   * El mensaje enumera las transiciones válidas para que la interfaz pueda
   * explicar la situación sin volver a codificar las reglas.
   */
  assertTransition(from: S, to: S): void {
    if (this.canTransition(from, to)) return;

    const allowed = this.nextStates(from);
    throw new BosError(
      "rule_violation",
      this.errorCode,
      allowed.length === 0
        ? `${this.definition.name} está en un estado terminal (${from}) y no admite cambios`
        : `${this.definition.name} no puede pasar de ${from} a ${to}`,
      [
        {
          rule: "STATE_TRANSITION_PUBLISHED",
          field: "status",
          remediation:
            allowed.length === 0
              ? "El agregado ya alcanzó un estado final"
              : `Transiciones válidas desde ${from}: ${allowed.join(", ")}`,
        },
      ],
    );
  }
}

const screamingSnake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
