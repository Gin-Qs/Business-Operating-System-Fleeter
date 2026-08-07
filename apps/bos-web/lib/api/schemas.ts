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
