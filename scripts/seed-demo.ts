import { randomUUID } from "node:crypto";
import { PERMISSIONS } from "@fleeter/contracts";
import type { Actor } from "@fleeter/domain";
import {
  closePools,
  contextFor,
  inviteMember,
  listInvitations,
  provisionTenant,
  withTenantTransaction,
} from "@fleeter/platform";
import { commercial, executeCommand, transport } from "@fleeter/core";

/**
 * Datos de demostración.
 *
 * Deja un tenant con solicitudes en TODOS los estados interesantes, para poder
 * revisar el avance sin capturar nada a mano.
 *
 * Todo se crea con los mismos comandos que usa la aplicación —no con inserts
 * directos—, así que lo que se ve en pantalla es comportamiento real: las
 * políticas se evaluaron de verdad, la auditoría existe y los eventos están en
 * el outbox. Un seed a base de INSERT produciría un sistema que parece funcionar
 * y no lo ha demostrado.
 *
 *   npm run seed:demo -- \
 *     --tenant-slug demo-fleeter \
 *     --owner-id <uuid de auth.users> \
 *     --owner-email correo@empresa.com \
 *     [--domain fleeter.demo]      # dominio de los correos invitados
 *
 * Es idempotente: reejecutarlo no duplica nada.
 *
 * ## Sobre las cuentas
 *
 * Este script NO crea identidades: las contraseñas pertenecen al proveedor de
 * identidad y el BOS nunca las gestiona. Lo que crea son INVITACIONES, que es
 * el camino real de alta. Cada persona entra al portal, usa "Me invitaron y aún
 * no tengo contraseña" con su correo, y queda operativa.
 *
 * Si el proyecto de Supabase exige confirmar el correo, usa `--domain` con un
 * dominio cuyos buzones puedas leer; con uno inventado los correos no llegan.
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  if (flag?.startsWith("--")) args.set(flag.slice(2), process.argv[i + 1] ?? "");
}

const required = (name: string): string => {
  const value = args.get(name);
  if (!value) {
    console.error(`Falta --${name}. Ver el encabezado del script para el uso completo.`);
    process.exit(1);
  }
  return value;
};

const slug = args.get("tenant-slug") ?? "demo-fleeter";
const ownerId = required("owner-id");
const ownerEmail = required("owner-email");
const domain = args.get("domain") ?? "fleeter.demo";

/** Cada rol del corte, con el correo desde el que se puede probar. */
const DEMO_ROLES = [
  ["comercial", "commercial_executive", "Captura solicitudes, envía cotizaciones y registra el desenlace"],
  ["pricing", "pricing", "Costea versiones y solicita excepciones de margen"],
  ["aprobador", "commercial_approver", "Aprueba o devuelve cotizaciones bajo el umbral"],
  ["credito", "credit_officer", "Mantiene límites y holds, autoriza excepciones de crédito"],
  ["operaciones", "operations", "Acepta la solicitud y compromete la orden"],
  ["auditor", "auditor", "Consulta todo sin poder cambiar nada"],
] as const;

const log = (message: string) => console.log(message);

async function main() {
  const tenant = await provisionTenant({
    slug,
    name: "Fleeter Demo S.A. de C.V.",
    baseCurrency: "MXN",
    timezone: "America/Mexico_City",
    legalEntityCode: "DEMO-MX",
    legalEntityName: "Fleeter Demo S.A. de C.V.",
    country: "MX",
    ownerUserId: ownerId,
    ownerEmail,
    ownerFullName: "Propietario de la demostración",
  });

  log(`Tenant ${slug}: ${tenant.tenantId}`);

  // El seed actúa con todas las facultades porque tiene que dejar el tenant en
  // un estado que normalmente construyen seis personas distintas. Cada acción
  // queda auditada a nombre del propietario, así que el rastro sigue siendo
  // explicable.
  const actor: Actor = {
    type: "user",
    userId: ownerId,
    tenantId: tenant.tenantId,
    legalEntityIds: null,
    permissions: new Set(PERMISSIONS),
  };

  const run = <T,>(command: string, entityType: string, fn: Parameters<typeof executeCommand<T>>[2]) =>
    executeCommand<T>(actor, { command, entityType }, fn).then((outcome) => outcome.result);

  // -------------------------------------------------------------------------
  // Maestros
  // -------------------------------------------------------------------------

  const existingCustomers = await run("ListCustomers", "Customer", (tx) =>
    commercial.listCustomers(tx, actor),
  );
  const customerByCode = new Map(existingCustomers.map((c) => [c.code, c]));

  const ensureCustomer = async (
    code: string,
    legalName: string,
    status: "prospect" | "active",
  ) => {
    const existing = customerByCode.get(code);
    if (existing) return existing;

    const created = await run("CreateCustomer", "Customer", (tx) =>
      commercial.createCustomer(tx, actor, {
        code,
        legalName,
        operatingCurrency: "MXN",
        status,
        legalEntityId: tenant.legalEntityId,
      }),
    );
    customerByCode.set(code, created);
    return created;
  };

  const acero = await ensureCustomer("DEMO-CLI-01", "Aceros del Bajío S.A. de C.V.", "active");
  const pacifico = await ensureCustomer(
    "DEMO-CLI-02",
    "Comercializadora Pacífico S. de R.L.",
    "active",
  );
  // Un prospecto sirve para ver la regla "solo clientes activos contratan".
  await ensureCustomer("DEMO-CLI-03", "Alimentos del Sur (prospecto)", "prospect");

  const existingLocations = await run("ListLocations", "Location", (tx) =>
    commercial.listLocations(tx, actor),
  );
  const locationByCode = new Map(existingLocations.map((l) => [l.code, l]));

  const ensureLocation = async (
    code: string,
    name: string,
    city: string,
    timezone: string,
    instructions: string,
  ) => {
    const existing = locationByCode.get(code);
    if (existing) return existing;

    const created = await run("CreateLocation", "Location", (tx) =>
      commercial.createLocation(tx, actor, {
        code,
        name,
        addressLine: "Parque Industrial, nave 4",
        city,
        country: "MX",
        timezone,
        instructions,
      }),
    );
    locationByCode.set(code, created);
    return created;
  };

  const monterrey = await ensureLocation(
    "DEMO-MTY",
    "Planta Monterrey",
    "Monterrey",
    "America/Monterrey",
    "Entrada por caseta 2. Cita obligatoria con 24 h.",
  );
  const queretaro = await ensureLocation(
    "DEMO-QRO",
    "CEDIS Querétaro",
    "Querétaro",
    "America/Mexico_City",
    "Recepción de 06:00 a 14:00.",
  );
  const manzanillo = await ensureLocation(
    "DEMO-ZLO",
    "Puerto Manzanillo",
    "Manzanillo",
    "America/Mexico_City",
    "Requiere pase portuario vigente.",
  );

  const existingProfiles = await run("ListServiceProfiles", "ServiceProfile", (tx) =>
    commercial.listServiceProfiles(tx, actor),
  );

  const profile =
    existingProfiles.find((p) => p.code === "DEMO-FTL") ??
    (await run("PublishServiceProfile", "ServiceProfile", (tx) =>
      commercial.publishServiceProfile(tx, actor, {
        code: "DEMO-FTL",
        serviceType: "FTL",
        equipmentType: "Caja seca 53 pies",
        commodity: "Carga general paletizada",
        requirements: { evidencia: ["POD firmado", "fotos de sello"], seguro_minimo_mxn: "500000" },
      }),
    ));

  log(`Maestros listos: ${customerByCode.size} clientes, ${locationByCode.size} ubicaciones`);

  // -------------------------------------------------------------------------
  // Crédito
  // -------------------------------------------------------------------------

  await run("SetCreditLimit", "CreditProfile", (tx) =>
    commercial.setCreditLimit(tx, actor, {
      customerId: acero.id,
      legalEntityId: tenant.legalEntityId,
      currency: "MXN",
      creditLimit: "2000000.00",
    }),
  );

  await run("SetCreditLimit", "CreditProfile", (tx) =>
    commercial.setCreditLimit(tx, actor, {
      customerId: pacifico.id,
      legalEntityId: tenant.legalEntityId,
      currency: "MXN",
      creditLimit: "400000.00",
    }),
  );

  // -------------------------------------------------------------------------
  // Solicitudes
  // -------------------------------------------------------------------------

  const known = await run("ListServiceRequests", "ServiceRequest", (tx) =>
    transport.listServiceRequests(tx, actor, { limit: 200 }),
  );
  const seen = new Set(known.map((request) => request.externalReference));

  interface Scenario {
    reference: string;
    customerId: string;
    origin: string | null;
    destination: string;
    commodity: string;
    /** Qué se hace después de crearla. */
    stage: "incomplete" | "pending_approval" | "sent" | "committed" | "credit_blocked";
    revenue: string;
    cost: string;
  }

  const scenarios: Scenario[] = [
    {
      reference: "DEMO-REQ-001",
      customerId: acero.id,
      origin: monterrey.id,
      destination: queretaro.id,
      commodity: "Rollo de acero laminado",
      stage: "committed",
      revenue: "45000.00",
      cost: "30000.00",
    },
    {
      reference: "DEMO-REQ-002",
      customerId: acero.id,
      origin: monterrey.id,
      destination: manzanillo.id,
      commodity: "Perfil estructural",
      // 4% de margen contra un umbral del 15%: exige excepción.
      stage: "pending_approval",
      revenue: "26000.00",
      cost: "25000.00",
    },
    {
      reference: "DEMO-REQ-003",
      customerId: acero.id,
      origin: null,
      destination: queretaro.id,
      commodity: "Alambrón",
      stage: "incomplete",
      revenue: "0",
      cost: "0",
    },
    {
      reference: "DEMO-REQ-004",
      customerId: pacifico.id,
      origin: queretaro.id,
      destination: manzanillo.id,
      commodity: "Abarrotes paletizados",
      stage: "sent",
      revenue: "38000.00",
      cost: "27000.00",
    },
    {
      reference: "DEMO-REQ-005",
      customerId: pacifico.id,
      origin: manzanillo.id,
      destination: monterrey.id,
      commodity: "Contenedor de importación",
      stage: "credit_blocked",
      revenue: "52000.00",
      cost: "36000.00",
    },
  ];

  for (const scenario of scenarios) {
    if (seen.has(scenario.reference)) {
      log(`  ${scenario.reference}: ya existía`);
      continue;
    }

    const request = await run("CreateServiceRequest", "ServiceRequest", (tx) =>
      transport.createServiceRequest(tx, actor, {
        customerId: scenario.customerId,
        legalEntityId: tenant.legalEntityId,
        currency: "MXN",
        externalReference: scenario.reference,
        originLocationId: scenario.origin,
        destinationLocationId: scenario.destination,
        pickupWindowStart: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        pickupWindowEnd: new Date(Date.now() + 3 * 24 * 3600 * 1000 + 6 * 3600 * 1000),
        deliveryWindowStart: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        deliveryWindowEnd: new Date(Date.now() + 5 * 24 * 3600 * 1000 + 8 * 3600 * 1000),
        serviceProfileId: profile.id,
        commodity: scenario.commodity,
        requiredEquipment: "Caja seca 53 pies",
        cargo: { peso_kg: "21000", tarimas: 24, embalaje: "Tarima de madera" },
      }),
    );

    const submitted = await run("SubmitServiceRequest", "ServiceRequest", (tx) =>
      transport.submitServiceRequest(tx, actor, { requestId: request.id }),
    );

    if (scenario.stage === "incomplete") {
      log(`  ${scenario.reference}: detenida por ${submitted.causes.join(", ")}`);
      continue;
    }

    const quote = await run("CreateQuote", "QuoteVersion", (tx) =>
      commercial.createQuote(tx, actor, transport.toQuotableRequest(submitted.request)),
    );

    const costed = await run("CostQuote", "QuoteVersion", (tx) =>
      commercial.costQuote(tx, actor, {
        quoteId: quote.id,
        charges: [
          { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: scenario.revenue },
          { kind: "cost", code: "OPERADOR", quantity: "1", unitAmount: scenario.cost },
        ],
        assumptions: {
          ruta: `${scenario.origin ? "origen" : "sin origen"} → destino`,
          indice_combustible: new Date().toISOString().slice(0, 7),
        },
      }),
    );

    if (scenario.stage === "pending_approval") {
      // Se queda esperando decisión, con la excepción de margen solicitada.
      await run("RequestQuoteApproval", "QuoteVersion", (tx) =>
        commercial.requestQuoteApproval(tx, actor, {
          quoteId: quote.id,
          reason: "Cliente estratégico: se recupera con el volumen comprometido del trimestre",
        }),
      );
      log(
        `  ${scenario.reference}: cotización en aprobación ` +
          `(margen ${costed.margin.marginPct !== null ? (costed.margin.marginPct * 100).toFixed(1) : "?"}%)`,
      );
      continue;
    }

    await run("ApproveQuote", "QuoteVersion", (tx) =>
      commercial.approveQuote(tx, actor, { quoteId: quote.id }),
    );

    await run("SendQuote", "QuoteVersion", (tx) =>
      commercial.sendQuote(tx, actor, { quoteId: quote.id, channel: "email" }),
    );

    if (scenario.stage === "sent") {
      log(`  ${scenario.reference}: cotización enviada, esperando al cliente`);
      continue;
    }

    await run("RecordQuoteDecision", "QuoteVersion", (tx) =>
      commercial.recordQuoteAcceptance(tx, actor, { quoteId: quote.id }),
    );

    if (scenario.stage === "credit_blocked") {
      // El hold se coloca DESPUÉS de ganar la cotización: es el caso realista
      // —el cliente aceptó y crédito lo detuvo— y deja ver el rastro del
      // rechazo, que se audita aunque la transacción se deshaga.
      await run("SetCreditHold", "CreditProfile", (tx) =>
        commercial.setCreditHold(tx, actor, {
          customerId: scenario.customerId,
          legalEntityId: tenant.legalEntityId,
          onHold: true,
          reason: "Dos facturas vencidas a más de 60 días",
        }),
      );

      const blocked = await run("AcceptServiceRequest", "ServiceRequest", (tx) =>
        transport.acceptServiceRequest(tx, actor, { requestId: request.id }),
      ).catch((error: { errorCode?: string }) => error.errorCode ?? "desconocido");

      log(`  ${scenario.reference}: aceptación bloqueada por crédito (${String(blocked)})`);
      continue;
    }

    await run("AcceptServiceRequest", "ServiceRequest", (tx) =>
      transport.acceptServiceRequest(tx, actor, {
        requestId: request.id,
        reason: "Factibilidad preliminar confirmada por operaciones",
      }),
    );

    const order = await run("CommitTransportOrder", "TransportOrder", (tx) =>
      transport.commitTransportOrder(tx, actor, { serviceRequestId: request.id }),
    );

    log(`  ${scenario.reference}: orden ${order.orderNumber} comprometida`);
  }

  // -------------------------------------------------------------------------
  // Invitaciones
  // -------------------------------------------------------------------------

  const invitations = await withTenantTransaction(
    contextFor(actor, randomUUID(), { legalEntityId: tenant.legalEntityId }),
    async (tx) => {
      for (const [local, roleCode] of DEMO_ROLES) {
        await inviteMember(tx, {
          email: `${local}@${domain}`,
          roleCode,
          expiresInDays: 90,
        });
      }
      return listInvitations(tx);
    },
  );

  const pending = invitations.filter((invitation) => invitation.status === "pending");

  // -------------------------------------------------------------------------

  log("\n─── Cuentas de demostración ───────────────────────────────");
  log(`Portal: inicia sesión con ${ownerEmail} (rol tenant_admin).`);
  log("Ese rol configura y consulta, pero no cotiza ni aprueba: es la");
  log("separación de docs/12 §3. Para ver cada vista, activa estas cuentas.\n");

  for (const [local, roleCode, what] of DEMO_ROLES) {
    const email = `${local}@${domain}`;
    const invited = pending.some((invitation) => invitation.email === email);
    log(`  ${email.padEnd(32)} ${roleCode.padEnd(22)} ${invited ? "invitada" : "revisar"}`);
    log(`  ${"".padEnd(32)} ${what}`);
  }

  log("\nPara activar cada una:");
  log("  1. Abrir el portal y pulsar «Me invitaron y aún no tengo contraseña».");
  log("  2. Poner ese correo y una contraseña nueva.");
  log("  3. Ingresar: el acceso ya queda activo con el rol invitado.");
  log("");
  log("Si el proyecto de Supabase exige confirmar el correo, usa --domain con");
  log("un dominio cuyos buzones puedas leer: con uno inventado no llega nada.");
  log("");
  log(`Solicitudes de ejemplo en /workspace/solicitudes del tenant ${slug}.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePools();
}
