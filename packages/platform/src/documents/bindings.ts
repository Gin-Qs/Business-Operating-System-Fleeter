/**
 * Resolvedores de enlaces: de una ruta declarada al dato real.
 *
 * Cada ruta que la migración 0019 siembra en `plt.document_binding` tiene que
 * estar implementada aquí, y una prueba compara las dos listas. La razón es
 * directa: el catálogo es lo que la interfaz le ofrece al tenant cuando
 * configura su plantilla. Ofrecer una ruta que el código no sabe resolver sería
 * prometer un dato que después saldría vacío, que es exactamente lo que todo
 * este subsistema existe para impedir.
 *
 * El resolvedor devuelve `{present:false}` cuando consultó y no había dato. No
 * devuelve cadena vacía: "no hay RFC registrado" y "el RFC es la cadena vacía"
 * son hechos distintos y solo el primero debe bloquear un documento.
 */

import type { ResolvedValue } from "@fleeter/domain";
import type { Tx } from "../db/unit-of-work";

export type BindingMap = Record<string, ResolvedValue>;

/** Contexto de emisión: no vive en ninguna tabla, ocurre al generar. */
export interface IssuanceContext {
  readonly issuedAt: Date;
  readonly issuedBy: string | null;
}

interface FormatOptions {
  readonly locale: string;
  readonly timezone: string;
}

const absent: ResolvedValue = { present: false };

const text = (value: unknown): ResolvedValue =>
  value === null || value === undefined || String(value).trim() === ""
    ? absent
    : { present: true, value: String(value) };

/**
 * Los importes llegan de PostgreSQL como cadena decimal exacta y se presentan
 * agrupados según el locale del tenant. No se convierten a número en el camino:
 * `Number("12345678901234.567890")` pierde dígitos, y un documento que se firma
 * no puede llevar un total redondeado por el transporte.
 */
const money = (value: unknown, { locale }: FormatOptions): ResolvedValue => {
  if (value === null || value === undefined) return absent;
  const raw = String(value);
  const negative = raw.startsWith("-");
  const [whole = "0", fraction = ""] = raw.replace("-", "").split(".");
  const groupedWhole = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(whole));
  const cents = `${fraction}00`.slice(0, 2);
  return { present: true, value: `${negative ? "-" : ""}${groupedWhole}.${cents}` };
};

const decimal = (value: unknown, { locale }: FormatOptions): ResolvedValue => {
  if (value === null || value === undefined) return absent;
  const raw = String(value);
  const [whole = "0", fraction] = raw.replace("-", "").split(".");
  const groupedWhole = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(whole));
  const trimmed = fraction?.replace(/0+$/, "");
  return {
    present: true,
    value: `${raw.startsWith("-") ? "-" : ""}${groupedWhole}${trimmed ? `.${trimmed}` : ""}`,
  };
};

/**
 * Las fechas se presentan en la zona horaria del tenant, no en UTC ni en la del
 * servidor. Una carta porte que dice "14 de marzo" cuando el operador cargó el
 * 13 a las 8 de la noche es un dato equivocado, no un detalle de formato.
 */
const datetime = (value: unknown, { locale, timezone }: FormatOptions): ResolvedValue => {
  if (!value) return absent;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return absent;
  return {
    present: true,
    value: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date),
  };
};

const rows = (items: ReadonlyArray<Record<string, string>>): ResolvedValue =>
  items.length === 0 ? absent : { present: true, rows: items };

/** Rutas comunes a todo documento. */
const issuanceBindings = (issuance: IssuanceContext, options: FormatOptions): BindingMap => ({
  "document.issued_at": datetime(issuance.issuedAt, options),
  "document.issued_by": text(issuance.issuedBy),
});

// ---------------------------------------------------------------------------
// Cotización
// ---------------------------------------------------------------------------

const QUOTE_SQL = `
  select
    t.name                as tenant_name,
    t.base_currency       as tenant_base_currency,
    t.default_locale      as tenant_locale,
    t.default_timezone    as tenant_timezone,
    le.legal_name         as entity_legal_name,
    le.tax_id             as entity_tax_id,
    le.code               as entity_code,
    le.country            as entity_country,
    c.legal_name          as customer_legal_name,
    c.tax_id              as customer_tax_id,
    c.code                as customer_code,
    c.operating_currency  as customer_currency,
    q.version, q.status, q.currency,
    q.quoted_revenue, q.quoted_cost, q.contracted_margin, q.contracted_margin_pct,
    q.fx_rate, q.costed_at, q.approved_at, q.sent_at, q.created_at,
    sr.external_reference, sr.commodity, sr.required_equipment,
    sr.pickup_window_start, sr.pickup_window_end,
    sr.delivery_window_start, sr.delivery_window_end,
    og.name as origin_name, og.address_line as origin_address, og.city as origin_city,
    og.state_province as origin_state, og.postal_code as origin_postal, og.country as origin_country,
    de.name as dest_name, de.address_line as dest_address, de.city as dest_city,
    de.state_province as dest_state, de.postal_code as dest_postal, de.country as dest_country
  from com.quote q
  join org.tenant t         on t.id  = q.tenant_id
  join org.legal_entity le  on le.id = q.legal_entity_id
  join com.customer c       on c.id  = q.customer_id
  join trn.service_request sr on sr.id = q.service_request_id
  left join com.location og on og.id = sr.origin_location_id
  left join com.location de on de.id = sr.destination_location_id
  where q.id = $1
`;

const QUOTE_CHARGES_SQL = `
  select kind::text, code, coalesce(description, '') as description,
         quantity, unit_amount, amount, currency
  from com.quote_charge
  where quote_id = $1
  order by kind, code
`;

export async function resolveQuoteBindings(
  tx: Tx,
  quoteId: string,
  issuance: IssuanceContext,
): Promise<BindingMap | null> {
  const { rows: found } = await tx.query(QUOTE_SQL, [quoteId]);
  const q = found[0];
  if (!q) return null;

  const options: FormatOptions = {
    locale: String(q.tenant_locale ?? "es-MX"),
    timezone: String(q.tenant_timezone ?? "UTC"),
  };

  const { rows: charges } = await tx.query(QUOTE_CHARGES_SQL, [quoteId]);

  return {
    ...issuanceBindings(issuance, options),

    "tenant.name": text(q.tenant_name),
    "tenant.base_currency": text(q.tenant_base_currency),
    "legal_entity.legal_name": text(q.entity_legal_name),
    "legal_entity.tax_id": text(q.entity_tax_id),
    "legal_entity.code": text(q.entity_code),
    "legal_entity.country": text(q.entity_country),

    "customer.legal_name": text(q.customer_legal_name),
    "customer.tax_id": text(q.customer_tax_id),
    "customer.code": text(q.customer_code),
    "customer.operating_currency": text(q.customer_currency),

    "quote.version": text(q.version),
    "quote.status": text(q.status),
    "quote.currency": text(q.currency),
    "quote.quoted_revenue": money(q.quoted_revenue, options),
    "quote.quoted_cost": money(q.quoted_cost, options),
    "quote.contracted_margin": money(q.contracted_margin, options),
    "quote.contracted_margin_pct": decimal(q.contracted_margin_pct, options),
    "quote.fx_rate": decimal(q.fx_rate, options),
    "quote.costed_at": datetime(q.costed_at, options),
    "quote.approved_at": datetime(q.approved_at, options),
    "quote.sent_at": datetime(q.sent_at, options),
    "quote.created_at": datetime(q.created_at, options),

    "quote.charges": rows(
      charges.map((c) => ({
        kind: String(c.kind),
        code: String(c.code),
        description: String(c.description),
        quantity: decimalText(c.quantity, options),
        unit_amount: moneyText(c.unit_amount, options),
        amount: moneyText(c.amount, options),
        currency: String(c.currency),
      })),
    ),

    "request.external_reference": text(q.external_reference),
    "request.commodity": text(q.commodity),
    "request.required_equipment": text(q.required_equipment),
    "request.pickup_window_start": datetime(q.pickup_window_start, options),
    "request.pickup_window_end": datetime(q.pickup_window_end, options),
    "request.delivery_window_start": datetime(q.delivery_window_start, options),
    "request.delivery_window_end": datetime(q.delivery_window_end, options),

    "request.origin.name": text(q.origin_name),
    "request.origin.address_line": text(q.origin_address),
    "request.origin.city": text(q.origin_city),
    "request.origin.state_province": text(q.origin_state),
    "request.origin.postal_code": text(q.origin_postal),
    "request.origin.country": text(q.origin_country),
    "request.destination.name": text(q.dest_name),
    "request.destination.address_line": text(q.dest_address),
    "request.destination.city": text(q.dest_city),
    "request.destination.state_province": text(q.dest_state),
    "request.destination.postal_code": text(q.dest_postal),
    "request.destination.country": text(q.dest_country),
  };
}

// ---------------------------------------------------------------------------
// Orden de transporte
// ---------------------------------------------------------------------------

const ORDER_SQL = `
  select
    t.name             as tenant_name,
    t.default_locale   as tenant_locale,
    t.default_timezone as tenant_timezone,
    le.legal_name      as entity_legal_name,
    le.tax_id          as entity_tax_id,
    c.legal_name       as customer_legal_name,
    c.tax_id           as customer_tax_id,
    c.code             as customer_code,
    o.order_number, o.status, o.currency,
    o.committed_revenue, o.committed_cost, o.committed_at,
    q.version as quote_version,
    sr.external_reference, sr.commodity, sr.required_equipment,
    og.name as origin_name, og.address_line as origin_address, og.city as origin_city,
    de.name as dest_name, de.address_line as dest_address, de.city as dest_city
  from trn.transport_order o
  join org.tenant t        on t.id  = o.tenant_id
  join org.legal_entity le on le.id = o.legal_entity_id
  join com.customer c      on c.id  = o.customer_id
  join com.quote q         on q.id  = o.quote_id
  join trn.service_request sr on sr.id = o.service_request_id
  left join com.location og on og.id = sr.origin_location_id
  left join com.location de on de.id = sr.destination_location_id
  where o.id = $1
`;

export async function resolveOrderBindings(
  tx: Tx,
  orderId: string,
  issuance: IssuanceContext,
): Promise<BindingMap | null> {
  const { rows: found } = await tx.query(ORDER_SQL, [orderId]);
  const o = found[0];
  if (!o) return null;

  const options: FormatOptions = {
    locale: String(o.tenant_locale ?? "es-MX"),
    timezone: String(o.tenant_timezone ?? "UTC"),
  };

  return {
    ...issuanceBindings(issuance, options),

    "tenant.name": text(o.tenant_name),
    "legal_entity.legal_name": text(o.entity_legal_name),
    "legal_entity.tax_id": text(o.entity_tax_id),
    "customer.legal_name": text(o.customer_legal_name),
    "customer.tax_id": text(o.customer_tax_id),
    "customer.code": text(o.customer_code),

    "order.order_number": text(o.order_number),
    "order.status": text(o.status),
    "order.currency": text(o.currency),
    "order.committed_revenue": money(o.committed_revenue, options),
    "order.committed_cost": money(o.committed_cost, options),
    "order.committed_at": datetime(o.committed_at, options),

    "quote.version": text(o.quote_version),

    "request.external_reference": text(o.external_reference),
    "request.commodity": text(o.commodity),
    "request.required_equipment": text(o.required_equipment),
    "request.origin.name": text(o.origin_name),
    "request.origin.address_line": text(o.origin_address),
    "request.origin.city": text(o.origin_city),
    "request.destination.name": text(o.dest_name),
    "request.destination.address_line": text(o.dest_address),
    "request.destination.city": text(o.dest_city),
  };
}

/** Los bloques repetidos necesitan celdas ya en texto, no `ResolvedValue`. */
const moneyText = (value: unknown, options: FormatOptions): string => {
  const resolved = money(value, options);
  return resolved.present && "value" in resolved ? resolved.value : "";
};

const decimalText = (value: unknown, options: FormatOptions): string => {
  const resolved = decimal(value, options);
  return resolved.present && "value" in resolved ? resolved.value : "";
};

/** Tipos de documento con resolvedor implementado. */
export const RESOLVABLE_KINDS = ["QUOTE", "TRANSPORT_ORDER"] as const;
export type ResolvableKind = (typeof RESOLVABLE_KINDS)[number];

export const isResolvableKind = (kind: string): kind is ResolvableKind =>
  (RESOLVABLE_KINDS as readonly string[]).includes(kind);

export async function resolveBindings(
  tx: Tx,
  kind: string,
  subjectId: string,
  issuance: IssuanceContext,
): Promise<BindingMap | null> {
  switch (kind) {
    case "QUOTE":
      return resolveQuoteBindings(tx, subjectId, issuance);
    case "TRANSPORT_ORDER":
      return resolveOrderBindings(tx, subjectId, issuance);
    default:
      return null;
  }
}
