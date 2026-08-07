import {
  BosError,
  POLICY_CODES,
  POLICY_REGISTRY,
  parsePolicyDefinition,
  type PolicyCode,
  type PolicyScope,
} from "@fleeter/contracts";
import { recordAudit } from "../audit/audit-log";
import type { Tx } from "../db/unit-of-work";
import { enqueueEvent } from "../outbox/outbox";

/**
 * Almacén de políticas configurables — docs/12 §8 y docs/03 §14.5.
 *
 * Una política no se edita: se publica una versión nueva y la anterior se
 * cierra conservando sus importes, su aprobador y su vigencia. Eso es lo que
 * permite explicar, meses después, con qué umbral se aprobó una cotización
 * concreta (docs/09 §12).
 */

export interface PolicyScopeRef {
  legalEntityId?: string | null;
  customerId?: string | null;
}

export interface ResolvedPolicy<T> {
  policyId: string;
  code: PolicyCode;
  version: number;
  scopeType: PolicyScope;
  scopeId: string | null;
  definition: T;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

interface ResolveRow {
  policy_id: string;
  code: string;
  version: number;
  scope_type: PolicyScope;
  scope_id: string | null;
  definition: unknown;
  effective_from: Date;
  effective_to: Date | null;
}

/**
 * Devuelve la política aplicable, o null si no hay ninguna configurada.
 *
 * La precedencia (cliente > entidad legal > tenant) vive en SQL, no aquí: si
 * cada llamador la implementara, dos pantallas acabarían resolviendo la misma
 * regla de forma distinta, que es exactamente lo que docs/03 §14.5 prohíbe.
 */
export async function resolvePolicy<T>(
  tx: Tx,
  code: PolicyCode,
  scope: PolicyScopeRef = {},
  at: Date = new Date(),
): Promise<ResolvedPolicy<T> | null> {
  const { rows } = await tx.query<ResolveRow>(
    "select * from org.resolve_policy($1, $2, $3, $4)",
    [code, at.toISOString(), scope.legalEntityId ?? null, scope.customerId ?? null],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    policyId: row.policy_id,
    code,
    version: row.version,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    definition: row.definition as T,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

/**
 * Como resolvePolicy, pero falla en lugar de devolver null.
 *
 * Una regla de negocio sin política configurada NO debe caer en un valor por
 * defecto silencioso: eso convierte un error de configuración en una decisión
 * económica invisible. Prefiere detenerse y decir qué falta.
 */
export async function requirePolicy<T>(
  tx: Tx,
  code: PolicyCode,
  scope: PolicyScopeRef = {},
  at: Date = new Date(),
): Promise<ResolvedPolicy<T>> {
  const policy = await resolvePolicy<T>(tx, code, scope, at);
  if (policy) return policy;

  throw new BosError(
    "rule_violation",
    "POLICY_NOT_CONFIGURED",
    `No hay una política ${code} vigente para este alcance`,
    [
      {
        rule: "POLICY_REQUIRED",
        remediation: `Publicar la política ${POLICY_REGISTRY[code].label} en la configuración del sistema`,
      },
    ],
  );
}

export interface PolicyRecord {
  policyId: string;
  code: string;
  version: number;
  status: string;
  scopeType: PolicyScope;
  scopeId: string | null;
  scopeLabel: string | null;
  definition: unknown;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  notes: string | null;
  publishedAt: Date | null;
}

/**
 * Historia completa de políticas del tenant, con el nombre legible del alcance.
 * Alimenta la pantalla de configuración y la auditoría.
 */
export async function listPolicies(tx: Tx, code?: PolicyCode): Promise<PolicyRecord[]> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    version: number;
    status: string;
    scope_type: PolicyScope;
    scope_id: string | null;
    scope_label: string | null;
    definition: unknown;
    effective_from: Date | null;
    effective_to: Date | null;
    notes: string | null;
    published_at: Date | null;
  }>(
    `select p.id, p.code, p.version, p.status::text as status,
            p.scope_type, p.scope_id,
            coalesce(le.legal_name, c.legal_name) as scope_label,
            p.definition, p.effective_from, p.effective_to, p.notes, p.published_at
     from org.policy p
     left join org.legal_entity le
       on p.scope_type = 'legal_entity' and le.id = p.scope_id
     left join com.customer c
       on p.scope_type = 'customer' and c.id = p.scope_id
     where ($1::text is null or p.code = $1)
     order by p.code, p.scope_type, p.version desc`,
    [code ?? null],
  );

  return rows.map((row) => ({
    policyId: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeLabel: row.scope_label,
    definition: row.definition,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    notes: row.notes,
    publishedAt: row.published_at,
  }));
}

export interface PublishPolicyInput {
  code: PolicyCode;
  scopeType: PolicyScope;
  scopeId?: string | null;
  definition: unknown;
  effectiveFrom?: Date;
  notes?: string | null;
}

export interface PublishedPolicy {
  policyId: string;
  version: number;
  supersededPolicyId: string | null;
}

/**
 * Publica una versión nueva y cierra la anterior.
 *
 * La autorización (`policy:publish`) la verifica el llamador con el Actor; aquí
 * llega ya resuelta. Lo que sí se hace aquí, siempre, es validar la definición
 * contra su esquema: una política inválida nunca debe alcanzar la base, porque
 * el fallo aparecería mucho después, al evaluar una cotización real.
 */
export async function publishPolicy(
  tx: Tx,
  input: PublishPolicyInput,
): Promise<PublishedPolicy> {
  const descriptor = POLICY_REGISTRY[input.code];

  if (!descriptor.scopes.includes(input.scopeType)) {
    throw new BosError(
      "invalid_input",
      "POLICY_SCOPE_NOT_SUPPORTED",
      `La política ${input.code} no admite el alcance ${input.scopeType}`,
      [
        {
          rule: "POLICY_SCOPE_ALLOWED",
          field: "scope_type",
          remediation: `Alcances válidos: ${descriptor.scopes.join(", ")}`,
        },
      ],
    );
  }

  if ((input.scopeType === "tenant") !== (input.scopeId == null)) {
    throw new BosError(
      "invalid_input",
      "POLICY_SCOPE_REFERENCE_MISMATCH",
      "El alcance de tenant no lleva destinatario; los demás lo exigen",
    );
  }

  const parsed = parsePolicyDefinition(input.code, input.definition);
  if (!parsed.success) {
    throw new BosError(
      "invalid_input",
      "POLICY_DEFINITION_INVALID",
      `La definición de ${input.code} no cumple su esquema`,
      parsed.error.issues.map((issue) => ({
        rule: "POLICY_SCHEMA",
        field: issue.path.join(".") || undefined,
        remediation: issue.message,
      })),
    );
  }

  const effectiveFrom = input.effectiveFrom ?? new Date();
  const scopeKey = [input.code, input.scopeType, input.scopeId ?? null] as const;

  // Cerrar la versión abierta ANTES de insertar: el índice único de "una sola
  // versión publicada y abierta por alcance" se evalúa de inmediato.
  const previous = await tx.query<{ id: string; version: number; definition: unknown }>(
    `update org.policy
     set status = 'superseded', effective_to = $4
     where code = $1 and scope_type = $2::org.policy_scope
       and scope_id is not distinct from $3
       and status = 'published' and effective_to is null
     returning id, version, definition`,
    [...scopeKey, effectiveFrom.toISOString()],
  );

  const { rows: maxRows } = await tx.query<{ next_version: number }>(
    `select coalesce(max(version), 0) + 1 as next_version
     from org.policy
     where code = $1 and scope_type = $2::org.policy_scope
       and scope_id is not distinct from $3`,
    scopeKey,
  );
  const version = maxRows[0]!.next_version;

  const { rows: inserted } = await tx.query<{ id: string }>(
    `insert into org.policy
       (tenant_id, code, version, status, scope_type, scope_id,
        definition, effective_from, published_by, published_at, notes)
     values ($1, $2, $3, 'published', $4::org.policy_scope, $5, $6, $7, $8, now(), $9)
     returning id`,
    [
      tx.context.tenantId,
      input.code,
      version,
      input.scopeType,
      input.scopeId ?? null,
      JSON.stringify(parsed.data),
      effectiveFrom.toISOString(),
      tx.context.actorId,
      input.notes ?? null,
    ],
  );

  const policyId = inserted[0]!.id;
  const superseded = previous.rows[0] ?? null;

  await recordAudit(tx, {
    action: "PolicyPublished",
    entityType: "Policy",
    entityId: policyId,
    entityVersion: version,
    before: superseded ? { version: superseded.version, definition: superseded.definition } : null,
    after: { version, definition: parsed.data },
    reason: input.notes ?? null,
    authorizationContext: {
      code: input.code,
      scope_type: input.scopeType,
      scope_id: input.scopeId ?? null,
      superseded_policy_id: superseded?.id ?? null,
    },
  });

  await enqueueEvent(tx, {
    eventType: "PolicyPublished",
    aggregateType: "Policy",
    aggregateId: policyId,
    aggregateVersion: version,
    effectiveAt: effectiveFrom,
    classification: "confidential",
    payload: {
      code: input.code,
      version,
      scope_type: input.scopeType,
      scope_id: input.scopeId ?? null,
      effective_from: effectiveFrom.toISOString(),
      superseded_policy_id: superseded?.id ?? null,
    },
  });

  return { policyId, version, supersededPolicyId: superseded?.id ?? null };
}

/**
 * Publica los valores de arranque del registro para las políticas que el tenant
 * todavía no tiene configuradas a nivel de tenant.
 *
 * Un tenant recién provisionado queda operable desde el primer minuto, y esos
 * valores son inmediatamente editables: son un punto de partida, no una
 * constante escondida.
 */
export async function ensureDefaultPolicies(tx: Tx): Promise<PolicyCode[]> {
  const seeded: PolicyCode[] = [];

  for (const code of POLICY_CODES) {
    const existing = await resolvePolicy(tx, code);
    if (existing) continue;

    await publishPolicy(tx, {
      code,
      scopeType: "tenant",
      definition: POLICY_REGISTRY[code].defaults,
      notes: "Valor de arranque del sistema; editable desde configuración",
    });
    seeded.push(code);
  }

  return seeded;
}
