import { BosError } from "@fleeter/contracts";
import { requirePermission, type Actor, type ResourceFacts } from "@fleeter/domain";
import { enqueueEvent, recordAudit, type Tx } from "@fleeter/platform";
import { notFound } from "../shared/command";

/**
 * Capacidad — BC-04, alcance de docs/13 §4.
 *
 * Lo mínimo para que el gate de liberación pueda responder sus preguntas:
 * ¿existe la unidad, está activa, cabe la carga, sirve el remolque, puede
 * conducir el operador, venció alguna credencial?
 *
 * La decisión que ordena todo el módulo está en docs/13 §12.2: la elegibilidad
 * SE CALCULA. Aquí no hay un `setEligible`, ni un campo que lo guarde, ni un job
 * que lo recalcule. Se leen los hechos y el dominio los nombra.
 */

export type ResourceKind = "vehicle" | "trailer" | "driver";

const TABLE: Record<ResourceKind, string> = {
  vehicle: "cap.vehicle",
  trailer: "cap.trailer_equipment",
  driver: "cap.driver",
};

const PERMISSION_READ: Record<ResourceKind, "vehicle:read" | "trailer:read" | "driver:read"> = {
  vehicle: "vehicle:read",
  trailer: "trailer:read",
  driver: "driver:read",
};

const PERMISSION_WRITE: Record<
  ResourceKind,
  "vehicle:write" | "trailer:write" | "driver:write"
> = {
  vehicle: "vehicle:write",
  trailer: "trailer:write",
  driver: "driver:write",
};

// ---------------------------------------------------------------------------
// Alta de recursos
// ---------------------------------------------------------------------------

export interface VehicleInput {
  legalEntityId: string;
  code: string;
  plate: string;
  vehicleType: string;
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  weightCapacityKg?: string | null;
  volumeCapacityM3?: string | null;
  ownership?: "owned" | "leased" | "carrier";
}

export async function registerVehicle(tx: Tx, actor: Actor, input: VehicleInput) {
  requirePermission(actor, "vehicle:write");

  const { rows } = await tx.query(
    `insert into cap.vehicle
       (tenant_id, legal_entity_id, code, plate, vehicle_type, make, model, model_year,
        weight_capacity_kg, volume_capacity_m3, ownership, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id, code, plate, status::text as status`,
    [
      tx.context.tenantId,
      input.legalEntityId,
      input.code,
      input.plate,
      input.vehicleType,
      input.make ?? null,
      input.model ?? null,
      input.modelYear ?? null,
      input.weightCapacityKg ?? null,
      input.volumeCapacityM3 ?? null,
      input.ownership ?? "owned",
      actor.userId,
    ],
  );

  const vehicle = rows[0] as { id: string; code: string };
  await recordAudit(tx, {
    action: "RegisterVehicle",
    entityType: "Vehicle",
    entityId: vehicle.id,
    after: { code: input.code, plate: input.plate },
  });

  return vehicle;
}

export interface TrailerInput {
  legalEntityId: string;
  code: string;
  plate?: string | null;
  equipmentType: string;
  weightCapacityKg?: string | null;
  volumeCapacityM3?: string | null;
  ownership?: "owned" | "leased" | "carrier";
}

export async function registerTrailer(tx: Tx, actor: Actor, input: TrailerInput) {
  requirePermission(actor, "trailer:write");

  const { rows } = await tx.query(
    `insert into cap.trailer_equipment
       (tenant_id, legal_entity_id, code, plate, equipment_type,
        weight_capacity_kg, volume_capacity_m3, ownership, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id, code, equipment_type as "equipmentType", status::text as status`,
    [
      tx.context.tenantId,
      input.legalEntityId,
      input.code,
      input.plate ?? null,
      input.equipmentType,
      input.weightCapacityKg ?? null,
      input.volumeCapacityM3 ?? null,
      input.ownership ?? "owned",
      actor.userId,
    ],
  );

  const trailer = rows[0] as { id: string; code: string };
  await recordAudit(tx, {
    action: "RegisterTrailer",
    entityType: "TrailerEquipment",
    entityId: trailer.id,
    after: { code: input.code, equipmentType: input.equipmentType },
  });

  return trailer;
}

export interface DriverInput {
  legalEntityId: string;
  code: string;
  fullName: string;
  phone?: string | null;
  /** Identidad del sistema. Sin ella el operador es asignable pero no ejecuta. */
  userAccountId?: string | null;
}

export async function registerDriver(tx: Tx, actor: Actor, input: DriverInput) {
  requirePermission(actor, "driver:write");

  const { rows } = await tx.query(
    `insert into cap.driver
       (tenant_id, legal_entity_id, code, full_name, phone, user_account_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, code, full_name as "fullName", status::text as status`,
    [
      tx.context.tenantId,
      input.legalEntityId,
      input.code,
      input.fullName,
      input.phone ?? null,
      input.userAccountId ?? null,
      actor.userId,
    ],
  );

  const driver = rows[0] as { id: string; code: string };
  await recordAudit(tx, {
    action: "RegisterDriver",
    entityType: "Driver",
    entityId: driver.id,
    after: { code: input.code, fullName: input.fullName },
  });

  return driver;
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

export interface CredentialInput {
  subjectType: ResourceKind;
  subjectId: string;
  credentialType: string;
  folio?: string | null;
  issuer?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  isMandatory?: boolean;
  documentUrl?: string | null;
}

/**
 * Registra o renueva una credencial.
 *
 * Es un upsert por (sujeto, tipo) a propósito: renovar una licencia actualiza su
 * vigencia, no crea una segunda fila. Dos filas del mismo tipo obligarían al
 * gate a desempatar cuál manda, y el criterio de desempate acabaría siendo "la
 * más reciente", que es exactamente lo que un upsert ya garantiza. El histórico
 * de renovaciones vive en la auditoría, que es donde docs/03 §1 lo pone.
 */
export async function recordCredential(tx: Tx, actor: Actor, input: CredentialInput) {
  requirePermission(actor, "credential:write");

  const { rows } = await tx.query(
    `insert into cap.credential
       (tenant_id, subject_type, subject_id, credential_type, folio, issuer,
        issued_on, expires_on, is_mandatory, document_url, created_by)
     values ($1,$2::cap.credential_subject,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (tenant_id, subject_type, subject_id, credential_type)
       do update set folio = excluded.folio,
                     issuer = excluded.issuer,
                     issued_on = excluded.issued_on,
                     expires_on = excluded.expires_on,
                     is_mandatory = excluded.is_mandatory,
                     document_url = excluded.document_url,
                     status = 'valid'
     returning id, credential_type as "credentialType", expires_on as "expiresOn"`,
    [
      tx.context.tenantId,
      input.subjectType,
      input.subjectId,
      input.credentialType,
      input.folio ?? null,
      input.issuer ?? null,
      input.issuedOn ?? null,
      input.expiresOn ?? null,
      input.isMandatory ?? true,
      input.documentUrl ?? null,
      actor.userId,
    ],
  );

  const credential = rows[0] as { id: string };
  await recordAudit(tx, {
    action: "RecordCredential",
    entityType: "Credential",
    entityId: credential.id,
    after: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      credentialType: input.credentialType,
      expiresOn: input.expiresOn ?? null,
    },
  });

  return credential;
}

// ---------------------------------------------------------------------------
// Bloqueo y liberación
// ---------------------------------------------------------------------------

/**
 * Retira un recurso de circulación.
 *
 * docs/13 §12.9: bloquear NO cancela los viajes ya liberados. Detenerlos en
 * automático dejaría carga a media ruta sin que nadie lo hubiera decidido. Lo
 * que sí ocurre es que el bloqueo se anuncia, y quien opera decide.
 */
export async function blockResource(
  tx: Tx,
  actor: Actor,
  input: {
    kind: ResourceKind;
    resourceId: string;
    reason: string;
    reviewAt?: string | null;
  },
) {
  requirePermission(actor, "resource:block");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "block_requires_reason",
      "Un bloqueo sin causa no se puede levantar: nadie sabría qué tendría que resolverse.",
    );
  }

  const { rows } = await tx.query(
    `update ${TABLE[input.kind]}
        set status = 'blocked', block_reason = $2, blocked_by = $3,
            blocked_at = now(), block_review_at = $4
      where id = $1
      returning id, code, status::text as status`,
    [input.resourceId, input.reason, actor.userId, input.reviewAt ?? null],
  );

  if (rows.length === 0) throw notFound(input.kind);
  const resource = rows[0] as { id: string; code: string };

  await recordAudit(tx, {
    action: "BlockResource",
    entityType: input.kind,
    entityId: resource.id,
    reason: input.reason,
    after: { status: "blocked", reviewAt: input.reviewAt ?? null },
  });

  // Los viajes en curso con este recurso quedan señalados. No se detienen: se
  // informa a quien puede decidir, que es lo que docs/09 §5 pide de una alerta.
  const { rows: affected } = await tx.query<{ id: string; trip_number: string }>(
    `select t.id, t.trip_number
       from trn.trip t
       join trn.assignment a on a.trip_id = t.id and a.status = 'confirmed'
      where t.tenant_id = $1
        and t.status in ('released','en_route_to_origin','at_origin','loading',
                         'in_transit','at_destination','unloading','delivered')
        and a.${input.kind === "trailer" ? "trailer_id" : `${input.kind}_id`} = $2`,
    [tx.context.tenantId, input.resourceId],
  );

  for (const trip of affected) {
    await tx.query(
      `insert into trn.trip_exception
         (tenant_id, trip_id, code, severity, description, impact, action, owner_user_id, raised_by)
       values ($1,$2,'resource_blocked_in_transit','high',$3,$4,$5,$6,$6)`,
      [
        tx.context.tenantId,
        trip.id,
        `Se bloqueó ${resource.code} mientras el viaje estaba en curso: ${input.reason}`,
        "El recurso no podrá reasignarse a otro viaje y este requiere revisión",
        "Decidir si el viaje continúa, se aborta o se reasigna al llegar",
        actor.userId,
      ],
    );
  }

  await enqueueEvent(tx, {
    eventType: "AssetBlocked",
    aggregateType: input.kind,
    aggregateId: resource.id,
    aggregateVersion: 1,
    payload: {
      code: resource.code,
      reason: input.reason,
      affected_trips: affected.map((t) => t.trip_number),
    },
  });

  return { ...resource, affectedTrips: affected.map((t) => t.trip_number) };
}

export async function releaseResource(
  tx: Tx,
  actor: Actor,
  input: { kind: ResourceKind; resourceId: string; reason?: string | null },
) {
  requirePermission(actor, "resource:block");

  const { rows } = await tx.query(
    `update ${TABLE[input.kind]}
        set status = 'active', block_reason = null, blocked_by = null,
            blocked_at = null, block_review_at = null
      where id = $1
      returning id, code, status::text as status`,
    [input.resourceId],
  );

  if (rows.length === 0) throw notFound(input.kind);
  const resource = rows[0] as { id: string; code: string };

  await recordAudit(tx, {
    action: "ReleaseResource",
    entityType: input.kind,
    entityId: resource.id,
    reason: input.reason ?? null,
    after: { status: "active" },
  });

  await enqueueEvent(tx, {
    eventType: "ResourceEligibilityChanged",
    aggregateType: input.kind,
    aggregateId: resource.id,
    aggregateVersion: 1,
    payload: { code: resource.code, status: "active" },
  });

  return resource;
}

// ---------------------------------------------------------------------------
// Hechos de elegibilidad
// ---------------------------------------------------------------------------

interface FactsRow {
  code: string;
  status: string;
  blockReason: string | null;
  invalidCredentials: number;
  weightCapacityKg: string | null;
  equipmentType: string | null;
}

/**
 * Lee los hechos de un recurso desde `cap.resource_facts`.
 *
 * Devuelve `null` cuando no existe, y el gate lo traduce a `vehicle_missing` o
 * `driver_missing`. No lanza: un recurso ausente es una causa del gate, no un
 * error de sistema.
 */
export async function resourceFacts(
  tx: Tx,
  kind: ResourceKind,
  resourceId: string | null,
): Promise<ResourceFacts | null> {
  if (!resourceId) return null;

  const { rows } = await tx.query<FactsRow>(
    `select code, status::text as status, block_reason as "blockReason",
            invalid_credentials as "invalidCredentials",
            weight_capacity_kg as "weightCapacityKg",
            equipment_type as "equipmentType"
       from cap.resource_facts
      where subject_type = $1::cap.credential_subject and subject_id = $2`,
    [kind, resourceId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    code: row.code,
    status: row.status as ResourceFacts["status"],
    blockReason: row.blockReason,
    invalidCredentials: Number(row.invalidCredentials),
    weightCapacityKg: row.weightCapacityKg,
    equipmentType: row.equipmentType,
  };
}

export async function listResources(tx: Tx, actor: Actor, kind: ResourceKind) {
  requirePermission(actor, PERMISSION_READ[kind]);

  const { rows } = await tx.query(
    `select f.subject_id as id, f.code, f.status::text as status,
            f.block_reason as "blockReason",
            f.invalid_credentials as "invalidCredentials",
            f.weight_capacity_kg as "weightCapacityKg",
            f.equipment_type as "equipmentType",
            -- La elegibilidad no se lee de una columna: se compone aquí de los
            -- mismos hechos que evalúa el gate, para que la lista y la
            -- liberación nunca digan cosas distintas.
            (f.status = 'active' and f.invalid_credentials = 0) as eligible
       from cap.resource_facts f
      where f.subject_type = $1::cap.credential_subject
      order by f.code`,
    [kind],
  );

  return rows;
}

export async function listCredentials(tx: Tx, actor: Actor, subjectId: string) {
  requirePermission(actor, "credential:read");

  const { rows } = await tx.query(
    `select id, subject_type::text as "subjectType", credential_type as "credentialType",
            folio, issuer, issued_on as "issuedOn", expires_on as "expiresOn",
            is_mandatory as "isMandatory", status::text as status,
            -- Vencida se deriva de la fecha, no de un campo que alguien marque.
            (expires_on is not null and expires_on < current_date) as expired
       from cap.credential
      where subject_id = $1
      order by credential_type`,
    [subjectId],
  );

  return rows;
}

export { PERMISSION_WRITE as RESOURCE_WRITE_PERMISSION };
