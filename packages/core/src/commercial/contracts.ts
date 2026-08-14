import { BosError } from "@fleeter/contracts";
import {
  contractLifecycle,
  requireDifferentApprover,
  requirePermission,
  type Actor,
  type ContractState,
} from "@fleeter/domain";
import { recordAudit, type Tx } from "@fleeter/platform";
import { assertRevision, notFound } from "../shared/command";
import { CONTRACT_DB, toContractState } from "../shared/states";

/**
 * Contrato y versión contractual — COM-007, docs/03 §7.
 *
 * Renegociar crea una versión. La anterior conserva su firma, su vigencia y sus
 * tarifas, porque la única pregunta que de verdad se le hace a un contrato en un
 * litigio es "¿qué habíamos firmado el 3 de marzo?", y un registro editado en
 * sitio no puede responderla.
 */

export interface ContractVersionRecord {
  id: string;
  contractId: string;
  version: number;
  status: ContractState;
  revision: number;
  currency: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  signedAt: Date | null;
}

const VERSION_COLUMNS = `id, contract_id as "contractId", version, status::text as status,
       revision, currency, effective_from as "effectiveFrom",
       effective_to as "effectiveTo", signed_at as "signedAt"`;

type VersionRow = Omit<ContractVersionRecord, "status"> & { status: string };

const toRecord = (row: VersionRow): ContractVersionRecord => ({
  ...row,
  status: toContractState(row.status),
});

export async function createContract(
  tx: Tx,
  actor: Actor,
  input: {
    legalEntityId: string;
    customerId: string;
    code: string;
    name: string;
    description?: string | null;
  },
) {
  requirePermission(actor, "contract:write");

  const { rows } = await tx.query<{ id: string }>(
    `insert into com.contract
       (tenant_id, legal_entity_id, customer_id, code, name, description, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [
      tx.context.tenantId,
      input.legalEntityId,
      input.customerId,
      input.code,
      input.name,
      input.description ?? null,
      actor.userId,
    ],
  );

  const contract = rows[0] as { id: string };
  await recordAudit(tx, {
    action: "CreateContract",
    entityType: "Contract",
    entityId: contract.id,
    after: { code: input.code, customerId: input.customerId },
  });

  return contract;
}

export interface ContractRateInput {
  chargeCode: string;
  description?: string | null;
  originZone?: string | null;
  destinationZone?: string | null;
  serviceType?: string | null;
  equipmentType?: string | null;
  uom: string;
  unitAmount: string;
  minimumAmount?: string | null;
  currency: string;
}

/**
 * Crea la siguiente versión de términos.
 *
 * Nunca sobrescribe: si ya hay versiones, esta toma el número siguiente. Las
 * tarifas se insertan con la versión y quedan inmutables — el precio pactado es
 * evidencia, no configuración editable.
 */
export async function createContractVersion(
  tx: Tx,
  actor: Actor,
  input: {
    contractId: string;
    currency: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    paymentTermsDays?: number | null;
    sla?: Record<string, unknown>;
    evidenceRules?: Record<string, unknown>;
    billingRules?: Record<string, unknown>;
    termsText?: string | null;
    rates?: readonly ContractRateInput[];
  },
): Promise<ContractVersionRecord> {
  requirePermission(actor, "contract:write");

  const { rows } = await tx.query<VersionRow>(
    `insert into com.contract_version
       (tenant_id, contract_id, version, currency, effective_from, effective_to,
        payment_terms_days, sla, evidence_rules, billing_rules, terms_text, created_by)
     values ($1,$2,
             coalesce((select max(version) from com.contract_version where contract_id = $2), 0) + 1,
             $3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning ${VERSION_COLUMNS}`,
    [
      tx.context.tenantId,
      input.contractId,
      input.currency,
      input.effectiveFrom ?? null,
      input.effectiveTo ?? null,
      input.paymentTermsDays ?? null,
      JSON.stringify(input.sla ?? {}),
      JSON.stringify(input.evidenceRules ?? {}),
      JSON.stringify(input.billingRules ?? {}),
      input.termsText ?? null,
      actor.userId,
    ],
  );

  const created = toRecord(rows[0] as VersionRow);

  for (const rate of input.rates ?? []) {
    await tx.query(
      `insert into com.contract_rate
         (tenant_id, contract_version_id, origin_zone, destination_zone, service_type,
          equipment_type, charge_code, description, uom, unit_amount, minimum_amount, currency)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tx.context.tenantId,
        created.id,
        rate.originZone ?? null,
        rate.destinationZone ?? null,
        rate.serviceType ?? null,
        rate.equipmentType ?? null,
        rate.chargeCode,
        rate.description ?? null,
        rate.uom,
        rate.unitAmount,
        rate.minimumAmount ?? null,
        rate.currency,
      ],
    );
  }

  await recordAudit(tx, {
    action: "CreateContractVersion",
    entityType: "ContractVersion",
    entityId: created.id,
    after: { version: created.version, rates: input.rates?.length ?? 0 },
  });

  return created;
}

async function requireVersion(tx: Tx, versionId: string) {
  const { rows } = await tx.query<VersionRow & { createdBy: string | null }>(
    `select ${VERSION_COLUMNS}, created_by as "createdBy"
       from com.contract_version where id = $1`,
    [versionId],
  );

  const row = rows[0];
  if (!row) throw notFound("ContractVersion");
  return { ...toRecord(row), createdBy: row.createdBy };
}

/**
 * Estados a los que NO se llega por `advanceContract`.
 *
 * Cada uno arrastra obligaciones que esta función no puede cumplir: `Active`
 * exige firma, vigencia, tarifas y un aprobador distinto del redactor;
 * `Terminated` exige un motivo. La base los rechazaría igual —dos checks de
 * 0020 lo garantizan—, pero lo haría con un error de restricción que no le dice
 * a nadie qué comando usar en su lugar.
 */
const CONTRACT_DEDICATED_TRANSITIONS: Readonly<Record<string, string>> = {
  Active: "activateContract",
  Terminated: "terminateContract",
};

export async function advanceContract(
  tx: Tx,
  actor: Actor,
  input: {
    versionId: string;
    to: ContractState;
    reason?: string | null;
    expectedRevision?: number | null;
  },
): Promise<ContractVersionRecord> {
  requirePermission(actor, "contract:write");

  const dedicated = CONTRACT_DEDICATED_TRANSITIONS[input.to];
  if (dedicated) {
    throw new BosError(
      "rule_violation",
      "contract_transition_needs_own_command",
      `Pasar a ${input.to} exige comprobaciones que este comando no hace: usar ${dedicated}.`,
    );
  }

  const current = await requireVersion(tx, input.versionId);
  assertRevision("contract", current.revision, input.expectedRevision);
  contractLifecycle.assertTransition(current.status, input.to);

  // `returning` y no el registro que ya teníamos en memoria: la escritura sube
  // la revisión, y devolver la anterior le daría al cliente un `If-Match` que su
  // siguiente llamada rechazaría por conflicto.
  const { rows } = await tx.query<VersionRow>(
    `update com.contract_version
        set status = $2::com.contract_status, revision = revision + 1
      where id = $1
      returning ${VERSION_COLUMNS}`,
    [input.versionId, CONTRACT_DB[input.to]],
  );

  await recordAudit(tx, {
    action: "AdvanceContract",
    entityType: "ContractVersion",
    entityId: input.versionId,
    reason: input.reason ?? null,
    before: { status: current.status },
    after: { status: input.to },
  });

  return toRecord(rows[0] as VersionRow);
}

/**
 * Firma y pone en vigor.
 *
 * docs/03 §7: `Active` exige versión firmada, vigencia y tarifas. La base
 * comprueba las dos primeras con un check; las tarifas hay que contarlas, y eso
 * solo puede hacerlo el dominio.
 *
 * Quien redactó la versión no la activa: es la misma regla de maker-checker de
 * docs/03 §14.3 mirando a la persona. Un contrato que se pone en vigor solo lo
 * revisó su autor.
 */
export async function activateContract(
  tx: Tx,
  actor: Actor,
  input: {
    versionId: string;
    signedAt: string;
    signedByName: string;
    signedDocumentUrl?: string | null;
    effectiveFrom: string;
    expectedRevision?: number | null;
  },
): Promise<ContractVersionRecord> {
  requirePermission(actor, "contract:activate");

  const current = await requireVersion(tx, input.versionId);
  assertRevision("contract", current.revision, input.expectedRevision);
  contractLifecycle.assertTransition(current.status, "Active");
  requireDifferentApprover(actor, current.createdBy);

  const { rows: rates } = await tx.query<{ count: string }>(
    `select count(*)::text as count from com.contract_rate where contract_version_id = $1`,
    [input.versionId],
  );

  if (Number(rates[0]?.count ?? 0) === 0) {
    throw new BosError(
      "rule_violation",
      "contract_requires_rates",
      "Un contrato activo sin tarifas no dice a qué precio se pactó nada. docs/03 §7 las exige para poner una versión en vigor.",
    );
  }

  // Retira la versión anterior: un índice parcial ya impide dos activas, pero
  // hacerlo explícito deja el `superseded_at` que explica cuándo dejó de regir.
  await tx.query(
    `update com.contract_version
        set status = 'expired', superseded_at = now()
      where contract_id = $1 and status = 'active' and id <> $2`,
    [current.contractId, input.versionId],
  );

  const { rows } = await tx.query<VersionRow>(
    `update com.contract_version
        set status = 'active', signed_at = $2, signed_by_name = $3,
            signed_document_url = $4, effective_from = $5,
            activated_by = $6, activated_at = now(), revision = revision + 1
      where id = $1
      returning ${VERSION_COLUMNS}`,
    [
      input.versionId,
      input.signedAt,
      input.signedByName,
      input.signedDocumentUrl ?? null,
      input.effectiveFrom,
      actor.userId,
    ],
  );

  await recordAudit(tx, {
    action: "ActivateContract",
    entityType: "ContractVersion",
    entityId: input.versionId,
    after: {
      status: "Active",
      signedByName: input.signedByName,
      effectiveFrom: input.effectiveFrom,
      rates: Number(rates[0]?.count ?? 0),
    },
  });

  return toRecord(rows[0] as VersionRow);
}

export async function terminateContract(
  tx: Tx,
  actor: Actor,
  input: { versionId: string; reason: string; expectedRevision?: number | null },
): Promise<ContractVersionRecord> {
  requirePermission(actor, "contract:terminate");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "termination_requires_reason",
      "Terminar un contrato sin motivo deja sin explicación una relación que se acabó.",
    );
  }

  const current = await requireVersion(tx, input.versionId);
  assertRevision("contract", current.revision, input.expectedRevision);
  contractLifecycle.assertTransition(current.status, "Terminated");

  const { rows } = await tx.query<VersionRow>(
    `update com.contract_version
        set status = 'terminated', terminated_at = now(), termination_reason = $2,
            revision = revision + 1
      where id = $1
      returning ${VERSION_COLUMNS}`,
    [input.versionId, input.reason],
  );

  await recordAudit(tx, {
    action: "TerminateContract",
    entityType: "ContractVersion",
    entityId: input.versionId,
    reason: input.reason,
    before: { status: current.status },
    after: { status: "Terminated" },
  });

  return toRecord(rows[0] as VersionRow);
}

/**
 * Lista los contratos con dos versiones distintas y a propósito.
 *
 * La ACTIVA es la que rige hoy; la ÚLTIMA es la que alguien está redactando. Un
 * listado que solo mostrara la activa haría invisible un contrato en borrador
 * —fila con todo en blanco y sin explicación— y quien lo redactó no encontraría
 * su propio trabajo.
 */
export async function listContracts(tx: Tx, actor: Actor, customerId?: string) {
  requirePermission(actor, "contract:read");

  const { rows } = await tx.query(
    `select c.id, c.code, c.name, c.customer_id as "customerId",
            cu.legal_name as "customerName",
            v.id as "activeVersionId", v.version as "activeVersion",
            v.effective_from as "effectiveFrom", v.effective_to as "effectiveTo",
            v.currency,
            l.id as "latestVersionId", l.version as "latestVersion",
            l.status::text as "latestStatus"
       from com.contract c
       join com.customer cu on cu.id = c.customer_id
       left join com.contract_version v
              on v.contract_id = c.id and v.status = 'active'
       left join lateral (
         select cv.id, cv.version, cv.status
           from com.contract_version cv
          where cv.contract_id = c.id
          order by cv.version desc
          limit 1
       ) l on true
      where ($1::uuid is null or c.customer_id = $1)
      order by c.code`,
    [customerId ?? null],
  );

  return rows;
}

/** Historial de términos de un contrato, del más reciente al primero. */
export async function listContractVersions(tx: Tx, actor: Actor, contractId: string) {
  requirePermission(actor, "contract:read");

  const { rows } = await tx.query(
    `select v.id, v.version, v.status::text as status, v.revision, v.currency,
            v.effective_from as "effectiveFrom", v.effective_to as "effectiveTo",
            v.signed_at as "signedAt", v.signed_by_name as "signedByName",
            v.payment_terms_days as "paymentTermsDays",
            v.terminated_at as "terminatedAt", v.termination_reason as "terminationReason",
            (select count(*) from com.contract_rate r where r.contract_version_id = v.id)::int
              as "rateCount"
       from com.contract_version v
      where v.contract_id = $1
      order by v.version desc`,
    [contractId],
  );

  return rows;
}

export async function getContractVersion(tx: Tx, actor: Actor, versionId: string) {
  requirePermission(actor, "contract:read");

  const version = await requireVersion(tx, versionId);

  const { rows: header } = await tx.query(
    `select c.code, c.name, c.customer_id as "customerId", cu.legal_name as "customerName",
            c.legal_entity_id as "legalEntityId"
       from com.contract c
       join com.customer cu on cu.id = c.customer_id
      where c.id = $1`,
    [version.contractId],
  );

  const { rows: rates } = await tx.query(
    `select charge_code as "chargeCode", description, origin_zone as "originZone",
            destination_zone as "destinationZone", service_type as "serviceType",
            equipment_type as "equipmentType", uom, unit_amount as "unitAmount",
            minimum_amount as "minimumAmount", currency
       from com.contract_rate where contract_version_id = $1 order by charge_code`,
    [versionId],
  );

  return { ...version, contract: header[0] ?? null, rates };
}
