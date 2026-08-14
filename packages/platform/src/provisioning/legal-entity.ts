import { BosError } from "@fleeter/contracts";
import { recordAudit } from "../audit/audit-log";
import type { Tx } from "../db/unit-of-work";

/**
 * Identidad fiscal de la razón social emisora — BC-01.
 *
 * Existe porque faltaba, y la ausencia la encontró una prueba y no una revisión:
 * el catálogo de enlaces ofrece `legal_entity.tax_id` para el contrato y la
 * cotización, pero el RFC del emisor solo se podía capturar al provisionar el
 * tenant. Después, nunca. Un documento que exige ese dato quedaba bloqueado para
 * siempre y quien lo configuró no tenía dónde arreglarlo.
 *
 * Eso es exactamente el defecto que el subsistema de plantillas existe para
 * impedir en las plantillas de otros, cometido aquí. Se corrige donde
 * corresponde: dando de dónde sacar el dato, no aflojando la regla.
 *
 * La autorización la verifica el llamador (`legal_entity:write`), como en el
 * resto de este módulo: aquí llega resuelta.
 */

export interface LegalEntityRecord {
  id: string;
  code: string;
  legalName: string;
  taxId: string | null;
  country: string;
  baseCurrency: string;
  timezone: string;
  status: string;
}

const COLUMNS = `id, code, legal_name as "legalName", tax_id as "taxId",
                 country, base_currency as "baseCurrency", timezone, status::text as status`;

export async function listLegalEntities(tx: Tx): Promise<LegalEntityRecord[]> {
  const { rows } = await tx.query<LegalEntityRecord>(
    `select ${COLUMNS} from org.legal_entity order by code`,
  );
  return rows;
}

export interface UpdateLegalEntityInput {
  legalEntityId: string;
  legalName: string;
  taxId: string | null;
  timezone: string;
}

/**
 * Corrige la identidad de la razón social.
 *
 * `code`, `country` y `base_currency` NO se tocan. No es rigidez: el código es
 * la referencia con la que la contabilidad y las integraciones nombran a esta
 * empresa, y el país y la moneda determinan cómo se leyeron importes ya
 * emitidos. Cambiar cualquiera de los tres reescribiría el significado de
 * documentos pasados; para eso se da de alta otra razón social.
 *
 * Lo que sí cambia es lo que un registro público cambia de verdad: la razón
 * social, el RFC y la zona horaria de operación.
 */
export async function updateLegalEntity(
  tx: Tx,
  input: UpdateLegalEntityInput,
): Promise<LegalEntityRecord> {
  if (input.legalName.trim() === "") {
    throw new BosError(
      "invalid_input",
      "legal_name_required",
      "La razón social es lo que aparece en cada documento emitido: no puede quedar vacía.",
    );
  }

  const { rows: before } = await tx.query<LegalEntityRecord>(
    `select ${COLUMNS} from org.legal_entity where id = $1`,
    [input.legalEntityId],
  );

  const current = before[0];
  if (!current) {
    throw new BosError("not_found", "legal_entity_not_found", "La razón social no existe.");
  }

  const { rows } = await tx.query<LegalEntityRecord>(
    `update org.legal_entity
        set legal_name = $2, tax_id = $3, timezone = $4
      where id = $1
      returning ${COLUMNS}`,
    [
      input.legalEntityId,
      input.legalName.trim(),
      input.taxId?.trim() ? input.taxId.trim() : null,
      input.timezone,
    ],
  );

  const updated = rows[0] as LegalEntityRecord;

  await recordAudit(tx, {
    action: "UpdateLegalEntity",
    entityType: "LegalEntity",
    entityId: input.legalEntityId,
    before: { legalName: current.legalName, taxId: current.taxId, timezone: current.timezone },
    after: { legalName: updated.legalName, taxId: updated.taxId, timezone: updated.timezone },
  });

  return updated;
}
