import { z } from "zod";

/**
 * Contratos de entrada de la API — docs/12 §7.
 *
 * Validar aquí no duplica las reglas de negocio: separa "esto no es una
 * petición bien formada" (400) de "esto no cumple una regla" (422). La segunda
 * la decide el dominio y describe qué corregir; la primera no debería llegar
 * nunca a tocarlo.
 *
 * Los importes viajan como cadena decimal, igual que se guardan. Un JSON con
 * `"unit_amount": 1033.33` ya perdió precisión antes de que el servidor lo lea,
 * y por eso el número no se acepta.
 */

const decimal = (max = 6) =>
  z.string().regex(new RegExp(`^-?\\d+(\\.\\d{1,${max}})?$`), 'Decimal como cadena, p. ej. "1033.33"');

const positiveDecimal = (max = 6) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${max}})?$`), "Decimal positivo como cadena");

const currency = z.string().regex(/^[A-Z]{3}$/, "Código ISO 4217");
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Maestros
// ---------------------------------------------------------------------------

export const createCustomerSchema = z.object({
  code: z.string().min(1).max(64),
  legal_name: z.string().min(1),
  tax_id: z.string().nullish(),
  operating_currency: currency,
  legal_entity_id: uuid.nullish(),
  status: z.enum(["prospect", "active", "on_hold", "inactive"]).optional(),
});

export const createContactSchema = z.object({
  customer_id: uuid,
  full_name: z.string().min(1),
  email: z.email().nullish(),
  phone: z.string().min(5).nullish(),
  role: z.string().nullish(),
  channel: z.enum(["email", "phone", "whatsapp", "portal"]).optional(),
  is_primary: z.boolean().optional(),
});

export const createLocationSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1),
  address_line: z.string().min(1),
  city: z.string().min(1),
  state_province: z.string().nullish(),
  postal_code: z.string().nullish(),
  country: z.string().regex(/^[A-Z]{2}$/, "Código ISO 3166-1 alfa-2"),
  // Nombre IANA: una abreviatura como "CST" no determina el horario de verano.
  timezone: z.string().regex(/^([A-Za-z]+\/[A-Za-z0-9_+-]+|UTC)$/, "Zona horaria IANA"),
  instructions: z.string().nullish(),
  customer_id: uuid.nullish(),
});

export const publishServiceProfileSchema = z.object({
  code: z.string().min(1).max(64),
  service_type: z.string().min(1),
  equipment_type: z.string().min(1),
  commodity: z.string().min(1),
  requirements: z.record(z.string(), z.unknown()).optional(),
  customer_id: uuid.nullish(),
});

export const creditLimitSchema = z.object({
  legal_entity_id: uuid,
  currency,
  credit_limit: positiveDecimal(2),
});

export const creditHoldSchema = z.object({
  legal_entity_id: uuid,
  on_hold: z.boolean(),
  reason: z.string().min(1).nullish(),
});

// ---------------------------------------------------------------------------
// Solicitud
// ---------------------------------------------------------------------------

const requestFields = {
  external_reference: z.string().min(1).nullish(),
  origin_location_id: uuid.nullish(),
  destination_location_id: uuid.nullish(),
  pickup_window_start: timestamp.nullish(),
  pickup_window_end: timestamp.nullish(),
  delivery_window_start: timestamp.nullish(),
  delivery_window_end: timestamp.nullish(),
  service_profile_id: uuid.nullish(),
  commodity: z.string().min(1).nullish(),
  required_equipment: z.string().min(1).nullish(),
  cargo: z.record(z.string(), z.unknown()).optional(),
};

export const createServiceRequestSchema = z.object({
  customer_id: uuid,
  legal_entity_id: uuid,
  currency,
  ...requestFields,
});

export const updateServiceRequestSchema = z.object(requestFields);

export const submitServiceRequestSchema = z.object({}).optional();

export const acceptServiceRequestSchema = z
  .object({ reason: z.string().min(1).nullish() })
  .optional();

export const cancelServiceRequestSchema = z.object({ reason: z.string().min(1) });

export const requestInformationSchema = z.object({
  causes: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Cotización
// ---------------------------------------------------------------------------

export const createQuoteSchema = z.object({ service_request_id: uuid });

export const costQuoteSchema = z.object({
  charges: z
    .array(
      z.object({
        kind: z.enum(["revenue", "cost"]),
        code: z.string().min(1).max(64),
        description: z.string().nullish(),
        quantity: positiveDecimal(),
        unit_amount: decimal(),
      }),
    )
    .min(1, "Una cotización sin cargos no tiene nada que decidir"),
  assumptions: z.record(z.string(), z.unknown()).optional(),
  fx_rate: positiveDecimal().nullish(),
  fx_rate_date: z.iso.date().nullish(),
});

export const requestQuoteApprovalSchema = z.object({ reason: z.string().min(1) });

export const approveQuoteSchema = z
  .object({
    reason: z.string().min(1).nullish(),
    grant_exception: z
      .object({ reason: z.string().min(1), expires_at: timestamp.nullish() })
      .nullish(),
  })
  .optional();

export const rejectQuoteApprovalSchema = z.object({ reason: z.string().min(1) });

export const sendQuoteSchema = z
  .object({
    contact_id: uuid.nullish(),
    channel: z.enum(["email", "phone", "whatsapp", "portal"]).optional(),
  })
  .optional();

export const quoteDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("accepted"), reason: z.string().min(1).nullish() }),
  // El rechazo del cliente exige motivo: es lo único que permite aprender del
  // mercado, y es la mitad del denominador de COM-001.
  z.object({ decision: z.literal("rejected"), reason: z.string().min(1) }),
]);

// ---------------------------------------------------------------------------
// Orden
// ---------------------------------------------------------------------------

export const commitOrderSchema = z.object({
  service_request_id: uuid,
  quote_id: uuid.nullish(),
  reason: z.string().min(1).nullish(),
});

/** Convierte una marca ISO opcional en Date, conservando null y undefined. */
export const asDate = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

// ---------------------------------------------------------------------------
// Contrato — COM-007
// ---------------------------------------------------------------------------

export const createContractSchema = z.object({
  legal_entity_id: uuid,
  customer_id: uuid,
  code: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string().nullish(),
});

export const createContractVersionSchema = z.object({
  currency,
  effective_from: timestamp.nullish(),
  effective_to: timestamp.nullish(),
  payment_terms_days: z.int().min(0).nullish(),
  sla: z.record(z.string(), z.unknown()).optional(),
  evidence_rules: z.record(z.string(), z.unknown()).optional(),
  billing_rules: z.record(z.string(), z.unknown()).optional(),
  terms_text: z.string().nullish(),
  rates: z
    .array(
      z.object({
        charge_code: z.string().min(1).max(64),
        description: z.string().nullish(),
        origin_zone: z.string().nullish(),
        destination_zone: z.string().nullish(),
        service_type: z.string().nullish(),
        equipment_type: z.string().nullish(),
        uom: z.string().min(1),
        unit_amount: positiveDecimal(),
        minimum_amount: positiveDecimal().nullish(),
        currency,
      }),
    )
    .optional(),
});

/**
 * `Active` y `Terminated` no figuran aquí.
 *
 * No es una omisión: cada uno arrastra obligaciones —firma y tarifas el
 * primero, motivo el segundo— y tiene su propio endpoint. El núcleo rechaza
 * igualmente esas dos transiciones por este camino; el enum solo hace que el
 * cliente se entere en el 400 y no después.
 */
export const advanceContractSchema = z.object({
  to: z.enum(["Draft", "InReview", "PendingSignature", "Suspended", "Expiring", "Renewed", "Expired"]),
  reason: z.string().min(1).nullish(),
});

export const activateContractSchema = z.object({
  signed_at: timestamp,
  signed_by_name: z.string().min(1, "Un contrato en vigor dice quién lo firmó"),
  signed_document_url: z.string().nullish(),
  effective_from: timestamp,
});

export const terminateContractSchema = z.object({
  reason: z.string().min(1, "Terminar un contrato sin motivo deja sin explicación una relación que se acabó"),
});

// ---------------------------------------------------------------------------
// Capacidad — docs/13 §4
// ---------------------------------------------------------------------------
//
// Las capacidades viajan como cadena decimal por la misma razón que el dinero:
// el gate compara el peso de la carga contra la capacidad de la unidad, y esa
// comparación no puede depender de cómo JSON.parse redondeó un double.

export const registerVehicleSchema = z.object({
  legal_entity_id: uuid,
  code: z.string().min(1).max(64),
  plate: z.string().min(1).max(32),
  vehicle_type: z.string().min(1),
  make: z.string().nullish(),
  model: z.string().nullish(),
  model_year: z.int().min(1950).max(2100).nullish(),
  weight_capacity_kg: positiveDecimal(3).nullish(),
  volume_capacity_m3: positiveDecimal(3).nullish(),
  ownership: z.enum(["owned", "leased", "carrier"]).optional(),
});

export const registerTrailerSchema = z.object({
  legal_entity_id: uuid,
  code: z.string().min(1).max(64),
  plate: z.string().nullish(),
  equipment_type: z.string().min(1),
  weight_capacity_kg: positiveDecimal(3).nullish(),
  volume_capacity_m3: positiveDecimal(3).nullish(),
  ownership: z.enum(["owned", "leased", "carrier"]).optional(),
});

export const registerDriverSchema = z.object({
  legal_entity_id: uuid,
  code: z.string().min(1).max(64),
  full_name: z.string().min(1),
  phone: z.string().nullish(),
  user_account_id: uuid.nullish(),
});

export const recordCredentialSchema = z.object({
  subject_type: z.enum(["vehicle", "trailer", "driver"]),
  subject_id: uuid,
  credential_type: z.string().min(1),
  folio: z.string().nullish(),
  issuer: z.string().nullish(),
  issued_on: z.iso.date().nullish(),
  expires_on: z.iso.date().nullish(),
  is_mandatory: z.boolean().optional(),
  document_url: z.string().nullish(),
});

export const blockResourceSchema = z.object({
  reason: z.string().min(1, "Un bloqueo sin causa no se puede levantar"),
  review_at: timestamp.nullish(),
});

export const releaseResourceSchema = z.object({
  reason: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Planeación y ejecución — docs/13 §10
// ---------------------------------------------------------------------------

export const createShipmentSchema = z.object({
  reference: z.string().nullish(),
  description: z.string().nullish(),
  total_weight_kg: positiveDecimal(3).nullish(),
  total_volume_m3: positiveDecimal(3).nullish(),
  total_pieces: z.int().min(0).nullish(),
  items: z
    .array(
      z.object({
        line_number: z.int().min(1),
        description: z.string().min(1),
        uom: z.string().min(1),
        quantity: positiveDecimal(),
        weight_kg: positiveDecimal(3).nullish(),
      }),
    )
    .min(1, "Una carga sin líneas no se puede entregar parcialmente ni contar"),
});

export const createStopsSchema = z.object({
  stops: z
    .array(
      z.object({
        kind: z.enum(["pickup", "delivery"]),
        location_id: uuid,
        sequence: z.int().min(1),
        window_start: timestamp.nullish(),
        window_end: timestamp.nullish(),
        contact_name: z.string().nullish(),
        contact_phone: z.string().nullish(),
        instructions: z.string().nullish(),
      }),
    )
    .min(2),
});

export const createRoutePlanSchema = z.object({
  total_distance_km: positiveDecimal(3).nullish(),
  estimated_duration_minutes: z.int().min(0).nullish(),
  restrictions: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullish(),
  stop_order: z
    .array(z.object({ stop_id: uuid, sequence: z.int().min(1) }))
    .optional(),
});

export const planTripSchema = z.object({
  transport_order_id: uuid,
  evidence_requirements: z.array(z.string().min(1)).optional(),
});

export const assignResourcesSchema = z.object({
  vehicle_id: uuid.nullish(),
  trailer_id: uuid.nullish(),
  driver_id: uuid.nullish(),
  notes: z.string().nullish(),
});

export const startTripSchema = z.object({
  odometer_km: positiveDecimal(3).nullish(),
});

export const stopArrivalSchema = z.object({
  latitude: decimal(6).nullish(),
  longitude: decimal(6).nullish(),
  notes: z.string().nullish(),
});

export const stopOutcomeSchema = z.object({
  reason: z.string().nullish(),
  signed_by: z.string().nullish(),
  lines: z
    .array(
      z.object({
        shipment_item_id: uuid,
        uom: z.string().min(1),
        planned: positiveDecimal(),
        loaded: positiveDecimal(),
        delivered: positiveDecimal(),
        rejected: positiveDecimal(),
        damaged: positiveDecimal(),
        returned: positiveDecimal(),
      }),
    )
    .min(1, "El desenlace se deriva de las cantidades: sin ellas saldría de la nada"),
});

export const closeTripSchema = z.object({
  odometer_end_km: positiveDecimal(3).nullish(),
});

export const submitEvidenceSchema = z.object({
  document_url: z.string().nullish(),
  content_type: z.string().nullish(),
  file_size_bytes: z.int().min(0).nullish(),
  latitude: decimal(6).nullish(),
  longitude: decimal(6).nullish(),
  notes: z.string().nullish(),
});

export const acceptEvidenceSchema = z.object({ notes: z.string().nullish() });

export const rejectEvidenceSchema = z.object({
  reason: z.string().min(1, "Un rechazo sin motivo obliga a adivinar qué recapturar"),
});

export const waiveEvidenceSchema = z.object({
  reason: z.string().min(1, "Dispensar una prueba de entrega exige explicación"),
});
