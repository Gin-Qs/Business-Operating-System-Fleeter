import { randomUUID } from "node:crypto";
import { BosError, isBosError } from "@fleeter/contracts";
import { executeCommand, type Tx } from "@fleeter/core";
import type { z } from "zod";
import { getSession, type BosSession } from "../session";

/**
 * Canal HTTP del corte Solicitud → Orden — docs/12 §7.
 *
 * "Las escrituras incluyen `Idempotency-Key`, `If-Match` para la versión
 * esperada y un `X-Correlation-Id` generado o propagado. Los errores de negocio
 * son estables, no exponen información entre tenants y devuelven un
 * identificador de correlación."
 *
 * Un canal no es dueño de ninguna regla (docs/02 §5): traduce HTTP a un comando
 * y el resultado de vuelta. Todo lo que decide —permiso, transición, política,
 * auditoría, evento— pasa en el núcleo, así que una integración que entre por
 * aquí obtiene exactamente el mismo comportamiento que la interfaz web.
 */

export interface ApiContext<TBody> {
  session: BosSession;
  body: TBody;
  /** Revisión esperada de `If-Match`, o null si el cliente no la envió. */
  ifMatch: number | null;
  correlationId: string;
}

export interface CommandSpec<TBody, TResult> {
  command: string;
  entityType: string;
  entityId?: string;
  /** Esquema del cuerpo. Su ausencia significa "sin cuerpo". */
  schema?: z.ZodType<TBody>;
  statusCode?: number;
  /**
   * Las escrituras la exigen. Se puede desactivar solo donde el comando ya es
   * idempotente por naturaleza y repetirlo no crea nada.
   */
  requireIdempotency?: boolean;
  describe?: (result: TResult) => { resourceType: string; resourceId: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Correlación propagada o generada.
 *
 * Si llega malformada se rechaza en lugar de sustituirla en silencio: quien la
 * envía la está usando para unir sus trazas con las nuestras, y devolverle otra
 * distinta rompería precisamente lo que intentaba conseguir.
 */
function resolveCorrelationId(request: Request): string {
  const header = request.headers.get("x-correlation-id");
  if (!header) return randomUUID();

  if (!UUID.test(header)) {
    throw new BosError(
      "invalid_input",
      "INVALID_CORRELATION_ID",
      "X-Correlation-Id debe ser un UUID",
      [{ rule: "CORRELATION_ID_FORMAT", field: "X-Correlation-Id" }],
    );
  }

  return header;
}

/** `If-Match: "3"` o `If-Match: 3`. */
function parseIfMatch(header: string | null): number | null {
  if (!header) return null;

  const value = Number(header.replace(/^W\//, "").replace(/"/g, "").trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new BosError("invalid_input", "INVALID_IF_MATCH", "If-Match debe ser la revisión vigente", [
      { rule: "IF_MATCH_FORMAT", field: "If-Match", remediation: 'Usar el ETag devuelto por el GET, por ejemplo "3"' },
    ]);
  }

  return value;
}

async function parseBody<TBody>(
  request: Request,
  schema: z.ZodType<TBody> | undefined,
): Promise<TBody> {
  if (!schema) return undefined as TBody;

  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new BosError("invalid_input", "INVALID_JSON", "El cuerpo no es JSON válido");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BosError(
      "invalid_input",
      "INVALID_REQUEST_BODY",
      "El cuerpo no cumple el contrato de la operación",
      parsed.error.issues.map((issue) => ({
        rule: "REQUEST_SCHEMA",
        field: issue.path.join(".") || undefined,
        remediation: issue.message,
      })),
    );
  }

  return parsed.data;
}

async function requireSession(request: Request): Promise<BosSession> {
  // El tenant se ELIGE entre las membresías de la identidad; nunca se cree por
  // sí solo (ADR-003). Una cabecera con el tenant de otro no resuelve nada.
  const requested = request.headers.get("x-tenant-id") ?? undefined;
  const session = await getSession(requested);

  if (!session) {
    throw new BosError(
      "unauthenticated",
      "SESSION_REQUIRED",
      "Se requiere una sesión con membresía activa",
    );
  }

  return session;
}

function errorResponse(error: unknown, correlationId: string): Response {
  if (isBosError(error)) {
    return Response.json(error.toBody(correlationId), {
      status: error.status,
      headers: { "x-correlation-id": correlationId, "cache-control": "no-store" },
    });
  }

  // Una falla no clasificada no describe su causa hacia afuera: el detalle
  // puede contener nombres de tabla, parámetros o datos de otro tenant.
  console.error("[api] fallo no controlado", { correlationId, error });

  return Response.json(
    {
      error_code: "INTERNAL_ERROR",
      message: "La operación no pudo completarse",
      correlation_id: correlationId,
    },
    { status: 500, headers: { "x-correlation-id": correlationId, "cache-control": "no-store" } },
  );
}

/** Escritura: exige idempotencia, respeta If-Match y devuelve la correlación. */
export async function apiCommand<TBody, TResult>(
  request: Request,
  spec: CommandSpec<TBody, TResult>,
  run: (tx: Tx, ctx: ApiContext<TBody>) => Promise<TResult>,
): Promise<Response> {
  let correlationId: string = randomUUID();

  try {
    correlationId = resolveCorrelationId(request);
    const session = await requireSession(request);

    // Las cabeceras se validan antes que el cuerpo: son el contrato del canal y
    // no dependen de lo que se envíe. A quien olvidó la clave de idempotencia le
    // sirve más saber eso que recibir una lista de campos que igualmente tendrá
    // que volver a mandar.
    const ifMatch = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = request.headers.get("idempotency-key");

    if (spec.requireIdempotency !== false && !idempotencyKey) {
      throw new BosError(
        "invalid_input",
        "IDEMPOTENCY_KEY_REQUIRED",
        "Toda escritura exige Idempotency-Key",
        [
          {
            rule: "IDEMPOTENCY_KEY_REQUIRED",
            field: "Idempotency-Key",
            remediation: "Generar un identificador único por intento de comando y reutilizarlo al reintentar",
          },
        ],
      );
    }

    const body = await parseBody(request, spec.schema);

    const outcome = await executeCommand<TResult>(
      session.actor,
      {
        command: spec.command,
        entityType: spec.entityType,
        entityId: spec.entityId ?? null,
        correlationId,
        statusCode: spec.statusCode ?? 200,
        ...(spec.describe ? { describe: spec.describe } : {}),
        ...(idempotencyKey
          ? { idempotency: { key: idempotencyKey, request: { body, entityId: spec.entityId ?? null } } }
          : { idempotency: null }),
      },
      (tx) => run(tx, { session, body, ifMatch, correlationId }),
    );

    return Response.json(outcome.result, {
      status: outcome.statusCode,
      headers: {
        "x-correlation-id": correlationId,
        // Permite a un cliente distinguir "se ejecutó" de "ya estaba hecho" sin
        // comparar cuerpos.
        "idempotent-replay": String(outcome.replayed),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/** Consulta: sin idempotencia, con ETag para que el cliente pueda usar If-Match. */
export async function apiQuery<TResult>(
  request: Request,
  spec: { command: string; entityType: string; entityId?: string; etag?: (result: TResult) => number },
  run: (tx: Tx, ctx: { session: BosSession; correlationId: string }) => Promise<TResult>,
): Promise<Response> {
  let correlationId: string = randomUUID();

  try {
    correlationId = resolveCorrelationId(request);
    const session = await requireSession(request);

    const outcome = await executeCommand<TResult>(
      session.actor,
      {
        command: spec.command,
        entityType: spec.entityType,
        entityId: spec.entityId ?? null,
        correlationId,
        idempotency: null,
      },
      (tx) => run(tx, { session, correlationId }),
    );

    const etag = spec.etag?.(outcome.result);

    return Response.json(outcome.result, {
      headers: {
        "x-correlation-id": correlationId,
        "cache-control": "no-store",
        ...(etag !== undefined ? { etag: `"${etag}"` } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
