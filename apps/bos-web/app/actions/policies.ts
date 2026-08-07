"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isBosError, isPolicyCode, type PolicyScope } from "@fleeter/contracts";
import { requirePermission } from "@fleeter/domain";
import { contextFor, publishPolicy, withTenantTransaction } from "@fleeter/platform";
import { definitionFromFormData } from "../../lib/policy-forms";
import { requireSession } from "../../lib/session";

export interface PublishPolicyState {
  error?: string;
  violations?: { rule: string; field?: string; remediation?: string }[];
  published?: { code: string; version: number };
}

/**
 * Publica una versión nueva de una política.
 *
 * La autorización se verifica aquí, del lado del servidor, contra el Actor
 * resuelto desde la membresía. Que el formulario no se muestre a quien no puede
 * publicar es comodidad; esto es el control.
 */
export async function publishPolicyAction(
  _prev: PublishPolicyState,
  formData: FormData,
): Promise<PublishPolicyState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "policy:publish");

    const code = String(formData.get("code") ?? "");
    if (!isPolicyCode(code)) {
      return { error: "Política desconocida." };
    }

    const scopeType = String(formData.get("scope_type") ?? "tenant") as PolicyScope;
    const rawScopeId = String(formData.get("scope_id") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    const result = await withTenantTransaction(
      contextFor(session.actor, randomUUID()),
      (tx) =>
        publishPolicy(tx, {
          code,
          scopeType,
          scopeId: scopeType === "tenant" ? null : rawScopeId || null,
          definition: definitionFromFormData(code, formData),
          notes: notes || null,
        }),
    );

    revalidatePath("/workspace/configuracion");
    return { published: { code, version: result.version } };
  } catch (error) {
    if (isBosError(error)) {
      return {
        error: error.message,
        violations: error.violations.map((v) => ({
          rule: v.rule,
          field: v.field,
          remediation: v.remediation,
        })),
      };
    }
    throw error;
  }
}
