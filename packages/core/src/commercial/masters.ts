import { BosError } from "@fleeter/contracts";
import { requirePermission, type Actor } from "@fleeter/domain";
import { recordAudit, type Tx } from "@fleeter/platform";
import { notFound } from "../shared/command";

/**
 * Maestros comerciales — BC-02, alcance de docs/12 §2.
 *
 * "Alta y consulta de cliente, contacto, ubicaciones y perfil de servicio."
 *
 * Son altas, no un CRUD completo: docs/03 §14.1 prohíbe el borrado físico, así
 * que dar de baja es cambiar estado, y corregir es una actualización auditada.
 * Cada alta deja rastro; ninguna emite evento porque el catálogo de docs/06 §4
 * no declara eventos de maestro para este corte, y un evento que nadie consume
 * es ruido con coste de mantenimiento.
 */

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export interface CustomerInput {
  code: string;
  legalName: string;
  taxId?: string | null;
  operatingCurrency: string;
  legalEntityId?: string | null;
  status?: "prospect" | "active" | "on_hold" | "inactive";
}

export interface CustomerRecord {
  id: string;
  code: string;
  legalName: string;
  taxId: string | null;
  status: string;
  operatingCurrency: string;
  legalEntityId: string | null;
}

export async function createCustomer(
  tx: Tx,
  actor: Actor,
  input: CustomerInput,
): Promise<CustomerRecord> {
  requirePermission(actor, "customer:write");

  const { rows } = await tx.query<CustomerRecord & { legal_entity_id: string | null }>(
    `insert into com.customer
       (tenant_id, legal_entity_id, code, legal_name, tax_id, status, operating_currency)
     values ($1, $2, $3, $4, $5, $6::com.customer_status, $7)
     returning id, code, legal_name as "legalName", tax_id as "taxId",
               status::text as status, operating_currency as "operatingCurrency",
               legal_entity_id`,
    [
      tx.context.tenantId,
      input.legalEntityId ?? tx.context.legalEntityId,
      input.code,
      input.legalName,
      input.taxId ?? null,
      input.status ?? "prospect",
      input.operatingCurrency.toUpperCase(),
    ],
  );

  const customer = { ...rows[0]!, legalEntityId: rows[0]!.legal_entity_id };

  await recordAudit(tx, {
    action: "CustomerCreated",
    entityType: "Customer",
    entityId: customer.id,
    after: { code: customer.code, legal_name: customer.legalName, status: customer.status },
  });

  return customer;
}

export async function listCustomers(tx: Tx, actor: Actor): Promise<CustomerRecord[]> {
  requirePermission(actor, "customer:read");

  const { rows } = await tx.query<CustomerRecord & { legal_entity_id: string | null }>(
    `select id, code, legal_name as "legalName", tax_id as "taxId",
            status::text as status, operating_currency as "operatingCurrency", legal_entity_id
     from com.customer order by legal_name`,
  );

  return rows.map((row) => ({ ...row, legalEntityId: row.legal_entity_id }));
}

/**
 * Cliente elegible para contratar.
 *
 * docs/12 §4: "Solo clientes activos pueden solicitar o contratar." Un prospecto
 * puede recibir una cotización —ese es el punto de un prospecto— pero no puede
 * quedar del otro lado de un compromiso.
 */
export async function requireContractableCustomer(
  tx: Tx,
  customerId: string,
): Promise<CustomerRecord> {
  const { rows } = await tx.query<CustomerRecord & { legal_entity_id: string | null }>(
    `select id, code, legal_name as "legalName", tax_id as "taxId",
            status::text as status, operating_currency as "operatingCurrency", legal_entity_id
     from com.customer where id = $1`,
    [customerId],
  );

  const customer = rows[0];
  if (!customer) throw notFound("Cliente");

  if (customer.status !== "active") {
    throw new BosError(
      "rule_violation",
      "CUSTOMER_NOT_ACTIVE",
      `El cliente ${customer.code} está en estado ${customer.status}`,
      [
        {
          rule: "ACTIVE_CUSTOMER_REQUIRED",
          field: "customer_id",
          remediation: "Activar el cliente antes de comprometer un servicio",
        },
      ],
    );
  }

  return { ...customer, legalEntityId: customer.legal_entity_id };
}

// ---------------------------------------------------------------------------
// Contacto
// ---------------------------------------------------------------------------

export interface ContactInput {
  customerId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  channel?: "email" | "phone" | "whatsapp" | "portal";
  isPrimary?: boolean;
}

export interface ContactRecord {
  id: string;
  customerId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  channel: string;
  isPrimary: boolean;
  status: string;
}

export async function createContact(
  tx: Tx,
  actor: Actor,
  input: ContactInput,
): Promise<ContactRecord> {
  requirePermission(actor, "customer:write");

  if (!input.email && !input.phone) {
    throw new BosError(
      "invalid_input",
      "CONTACT_UNREACHABLE",
      "Un contacto sin correo ni teléfono no sirve para enviar una cotización",
      [{ rule: "CONTACT_REACHABLE", field: "email" }],
    );
  }

  const { rows } = await tx.query<{
    id: string;
    customer_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    channel: string;
    is_primary: boolean;
    status: string;
  }>(
    `insert into com.contact
       (tenant_id, customer_id, full_name, email, phone, role, channel, is_primary)
     values ($1, $2, $3, $4, $5, $6, $7::com.contact_channel, $8)
     returning id, customer_id, full_name, email, phone, channel::text as channel,
               is_primary, status::text as status`,
    [
      tx.context.tenantId,
      input.customerId,
      input.fullName,
      input.email ?? null,
      input.phone ?? null,
      input.role ?? null,
      input.channel ?? "email",
      input.isPrimary ?? false,
    ],
  );

  const row = rows[0]!;
  const contact: ContactRecord = {
    id: row.id,
    customerId: row.customer_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    channel: row.channel,
    isPrimary: row.is_primary,
    status: row.status,
  };

  await recordAudit(tx, {
    action: "ContactCreated",
    entityType: "Contact",
    entityId: contact.id,
    // Los datos de contacto son restricted (COM-002): la auditoría guarda a
    // quién se agregó, no su correo ni su teléfono.
    after: { customer_id: contact.customerId, channel: contact.channel },
  });

  return contact;
}

export async function listContacts(
  tx: Tx,
  actor: Actor,
  customerId: string,
): Promise<ContactRecord[]> {
  requirePermission(actor, "customer:read");

  const { rows } = await tx.query<{
    id: string;
    customer_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    channel: string;
    is_primary: boolean;
    status: string;
  }>(
    `select id, customer_id, full_name, email, phone, channel::text as channel,
            is_primary, status::text as status
     from com.contact where customer_id = $1 and status = 'active'
     order by is_primary desc, full_name`,
    [customerId],
  );

  return rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    channel: row.channel,
    isPrimary: row.is_primary,
    status: row.status,
  }));
}

// ---------------------------------------------------------------------------
// Ubicación
// ---------------------------------------------------------------------------

export interface LocationInput {
  code: string;
  name: string;
  addressLine: string;
  city: string;
  stateProvince?: string | null;
  postalCode?: string | null;
  country: string;
  timezone: string;
  instructions?: string | null;
  customerId?: string | null;
}

export interface LocationRecord {
  id: string;
  code: string;
  name: string;
  addressLine: string;
  city: string;
  country: string;
  timezone: string;
  instructions: string | null;
  customerId: string | null;
  status: string;
}

const LOCATION_COLUMNS = `id, code, name, address_line as "addressLine", city,
       country, timezone, instructions, customer_id as "customerId", status::text as status`;

export async function createLocation(
  tx: Tx,
  actor: Actor,
  input: LocationInput,
): Promise<LocationRecord> {
  requirePermission(actor, "location:write");

  const { rows } = await tx.query<LocationRecord>(
    `insert into com.location
       (tenant_id, customer_id, code, name, address_line, city, state_province,
        postal_code, country, timezone, instructions)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${LOCATION_COLUMNS}`,
    [
      tx.context.tenantId,
      input.customerId ?? null,
      input.code,
      input.name,
      input.addressLine,
      input.city,
      input.stateProvince ?? null,
      input.postalCode ?? null,
      input.country.toUpperCase(),
      input.timezone,
      input.instructions ?? null,
    ],
  );

  const location = rows[0]!;

  await recordAudit(tx, {
    action: "LocationCreated",
    entityType: "Location",
    entityId: location.id,
    after: { code: location.code, country: input.country, timezone: location.timezone },
  });

  return location;
}

export async function listLocations(tx: Tx, actor: Actor): Promise<LocationRecord[]> {
  requirePermission(actor, "location:read");

  const { rows } = await tx.query<LocationRecord>(
    `select ${LOCATION_COLUMNS} from com.location where status = 'active' order by name`,
  );

  return rows;
}

/** Ubicación utilizable como origen o destino. */
export async function requireLocation(tx: Tx, locationId: string): Promise<LocationRecord> {
  const { rows } = await tx.query<LocationRecord>(
    `select ${LOCATION_COLUMNS} from com.location where id = $1`,
    [locationId],
  );

  const location = rows[0];
  if (!location) throw notFound("Ubicación");
  return location;
}

// ---------------------------------------------------------------------------
// Perfil de servicio
// ---------------------------------------------------------------------------

export interface ServiceProfileInput {
  code: string;
  serviceType: string;
  equipmentType: string;
  commodity: string;
  requirements?: Record<string, unknown>;
  customerId?: string | null;
}

export interface ServiceProfileRecord {
  id: string;
  code: string;
  version: number;
  status: string;
  serviceType: string;
  equipmentType: string;
  commodity: string;
  requirements: Record<string, unknown>;
  customerId: string | null;
}

const PROFILE_COLUMNS = `id, code, version, status::text as status,
       service_type as "serviceType", equipment_type as "equipmentType", commodity,
       requirements, customer_id as "customerId"`;

/**
 * Publica una versión nueva del perfil y cierra la anterior.
 *
 * docs/12 §4: "Versionado; la solicitud guarda el perfil aplicado." Cambiar los
 * requisitos de un servicio no puede reescribir lo que se pactó en una
 * solicitud anterior, así que no se edita en sitio: se publica y se conserva.
 */
export async function publishServiceProfile(
  tx: Tx,
  actor: Actor,
  input: ServiceProfileInput,
): Promise<ServiceProfileRecord> {
  requirePermission(actor, "service_profile:write");

  const now = new Date();

  await tx.query(
    `update com.service_profile
     set status = 'superseded', effective_to = $2
     where code = $1 and status = 'published' and effective_to is null`,
    [input.code, now.toISOString()],
  );

  const { rows: next } = await tx.query<{ next_version: number }>(
    `select coalesce(max(version), 0) + 1 as next_version
     from com.service_profile where code = $1`,
    [input.code],
  );

  const { rows } = await tx.query<ServiceProfileRecord>(
    `insert into com.service_profile
       (tenant_id, customer_id, code, version, status, service_type,
        equipment_type, commodity, requirements, effective_from)
     values ($1, $2, $3, $4, 'published', $5, $6, $7, $8, $9)
     returning ${PROFILE_COLUMNS}`,
    [
      tx.context.tenantId,
      input.customerId ?? null,
      input.code,
      next[0]!.next_version,
      input.serviceType,
      input.equipmentType,
      input.commodity,
      JSON.stringify(input.requirements ?? {}),
      now.toISOString(),
    ],
  );

  const profile = rows[0]!;

  await recordAudit(tx, {
    action: "ServiceProfilePublished",
    entityType: "ServiceProfile",
    entityId: profile.id,
    entityVersion: profile.version,
    after: {
      code: profile.code,
      version: profile.version,
      service_type: profile.serviceType,
      equipment_type: profile.equipmentType,
    },
  });

  return profile;
}

export async function listServiceProfiles(
  tx: Tx,
  actor: Actor,
): Promise<ServiceProfileRecord[]> {
  requirePermission(actor, "service_profile:read");

  const { rows } = await tx.query<ServiceProfileRecord>(
    `select ${PROFILE_COLUMNS} from com.service_profile
     where status = 'published' and effective_to is null
     order by code`,
  );

  return rows;
}
