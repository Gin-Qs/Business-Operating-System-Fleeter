import { describe, expect, it } from "vitest";
import type { Permission } from "@fleeter/contracts";
import {
  requireDifferentApprover,
  requireLegalEntityScope,
  requirePermission,
  type Actor,
} from "@fleeter/domain";

const actorWith = (
  permissions: Permission[],
  overrides: Partial<Actor> = {},
): Actor => ({
  type: "user",
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legalEntityIds: null,
  permissions: new Set(permissions),
  ...overrides,
});

describe("permisos", () => {
  it("deja pasar al actor que tiene el permiso", () => {
    expect(() => requirePermission(actorWith(["quote:approve"]), "quote:approve")).not.toThrow();
  });

  it("niega y nombra el permiso faltante", () => {
    expect(() => requirePermission(actorWith(["quote:read"]), "quote:approve")).toThrowError(
      /quote:approve/,
    );
  });

  it("responde 403, no 404, dentro del propio tenant", () => {
    // Revelar que falta un permiso no filtra nada: el solicitante ya está
    // autenticado y dentro de su tenant. Lo que nunca se revela es la
    // existencia de recursos ajenos, y de eso se encarga el aislamiento.
    try {
      requirePermission(actorWith([]), "quote:approve");
      expect.unreachable("debió lanzar");
    } catch (error) {
      expect((error as { status: number }).status).toBe(403);
      expect((error as { errorCode: string }).errorCode).toBe("PERMISSION_DENIED");
    }
  });
});

describe("alcance por entidad legal", () => {
  const entityA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const entityB = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  it("una membresía sin restricción alcanza cualquier entidad del tenant", () => {
    const actor = actorWith(["customer:read"], { legalEntityIds: null });
    expect(() => requireLegalEntityScope(actor, entityB)).not.toThrow();
  });

  it("una membresía acotada no alcanza otra entidad", () => {
    const actor = actorWith(["customer:read"], { legalEntityIds: [entityA] });
    expect(() => requireLegalEntityScope(actor, entityA)).not.toThrow();
    expect(() => requireLegalEntityScope(actor, entityB)).toThrowError(/fuera del alcance/);
  });
});

describe("maker-checker", () => {
  // docs/03 §14.3: sin aprobación propia cuando la política lo exige.
  it("impide que quien solicita apruebe", () => {
    const actor = actorWith(["quote:approve"]);
    expect(() => requireDifferentApprover(actor, actor.userId)).toThrowError(
      /no puede aprobarla/,
    );
  });

  it("permite aprobar a otra persona", () => {
    const actor = actorWith(["quote:approve"]);
    expect(() =>
      requireDifferentApprover(actor, "99999999-9999-4999-8999-999999999999"),
    ).not.toThrow();
  });
});
