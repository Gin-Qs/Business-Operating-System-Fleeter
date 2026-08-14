import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@fleeter/domain";
import {
  closePools,
  createTemplateVersion,
  listBindings,
  proposeFieldsFromBody,
  publishTemplate,
  renderTemplate,
  setTemplateFields,
  updateLegalEntity,
} from "@fleeter/platform";
import { commercial, executeCommand, executeQuery } from "@fleeter/core";
import {
  actorFor,
  hasDatabase,
  provisionTestTenants,
  uniqueCode,
  type TestTenant,
} from "./fixtures";

/**
 * La cadena que el sistema promete: contrato propio → formato propio → documento.
 *
 * Esta prueba existe porque la petición era literal: "quiero poder subirte mi
 * formato de contratos y que lo utilices así. No quiero información vacía o
 * inventada". Cada `it` de aquí es una mitad de esa frase.
 *
 * Lo que se verifica no es que el motor sustituya cadenas —eso ya lo cubren las
 * pruebas de dominio, sin base— sino que el dato que sale del documento sea el
 * que alguien capturó en el contrato, y que cuando no lo capturó el documento no
 * salga.
 */

const CONTRACT_BODY = `
<h1>Contrato de prestación de servicios de transporte</h1>
<p>Entre <strong>{{emisor}}</strong>, RFC {{rfc_emisor}}, y
   <strong>{{cliente}}</strong>, RFC {{rfc_cliente}}.</p>
<p>Contrato {{clave_contrato}} versión {{numero_version}}, en {{moneda}},
   con {{dias_credito}} días de crédito.</p>
<p>Vigente desde {{vigente_desde}}. Firmado el {{fecha_firma}} por {{firmante}}.</p>
<h2>Tarifario</h2>
<table>
{{#each tarifas}}<tr><td>{{charge_code}}</td><td>{{description}}</td>
    <td>{{uom}}</td><td>{{unit_amount}} {{currency}}</td></tr>
{{/each}}
</table>
<footer>Emitido el {{fecha_emision}}.</footer>
`;

/** Enlace elegido a mano para cada marcador, como lo haría quien configura. */
const BINDINGS: Record<string, string> = {
  emisor: "legal_entity.legal_name",
  rfc_emisor: "legal_entity.tax_id",
  cliente: "customer.legal_name",
  rfc_cliente: "customer.tax_id",
  clave_contrato: "contract.code",
  numero_version: "contract.version",
  moneda: "contract.currency",
  dias_credito: "contract.payment_terms_days",
  vigente_desde: "contract.effective_from",
  fecha_firma: "contract.signed_at",
  firmante: "contract.signed_by_name",
  tarifas: "contract.rates",
  fecha_emision: "document.issued_at",
};

describe.skipIf(!hasDatabase)("del contrato al documento", () => {
  let alpha: TestTenant;
  let full: Actor;
  /** Redactor y aprobador son personas distintas: docs/03 §14.3. */
  let approver: Actor;
  let customerId: string;

  const run = <T>(command: string, entityType: string, fn: Parameters<typeof executeCommand<T>>[2]) =>
    executeCommand<T>(full, { command, entityType }, fn).then((o) => o.result);

  const asApprover = <T>(command: string, fn: Parameters<typeof executeCommand<T>>[2]) =>
    executeCommand<T>(approver, { command, entityType: "ContractVersion" }, fn).then((o) => o.result);

  const query = <T>(command: string, fn: Parameters<typeof executeQuery<T>>[2]) =>
    executeQuery<T>(full, { command, entityType: "Contract" }, fn);

  /** Contrato firmado y en vigor, con tarifas. El sujeto de los documentos. */
  const activeContract = async (options: { paymentTermsDays: number | null }) => {
    const contract = await run<{ id: string }>("CreateContract", "Contract", (tx) =>
      commercial.createContract(tx, full, {
        legalEntityId: alpha.legalEntityId,
        customerId,
        code: uniqueCode("CTR"),
        name: "Servicio de transporte terrestre",
      }),
    );

    const version = await run<{ id: string; revision: number }>(
      "CreateContractVersion",
      "ContractVersion",
      (tx) =>
        commercial.createContractVersion(tx, full, {
          contractId: contract.id,
          currency: "MXN",
          paymentTermsDays: options.paymentTermsDays,
          termsText: "Cláusulas pactadas con el cliente.",
          rates: [
            {
              chargeCode: "FLETE",
              description: "Flete Monterrey–Querétaro",
              uom: "viaje",
              unitAmount: "45000.00",
              currency: "MXN",
            },
            {
              chargeCode: "ESTADIA",
              description: "Estadía por hora excedente",
              uom: "hora",
              unitAmount: "350.00",
              minimumAmount: "700.00",
              currency: "MXN",
            },
          ],
        }),
    );

    await run("AdvanceContract", "ContractVersion", (tx) =>
      commercial.advanceContract(tx, full, { versionId: version.id, to: "InReview" }),
    );
    await run("AdvanceContract", "ContractVersion", (tx) =>
      commercial.advanceContract(tx, full, { versionId: version.id, to: "PendingSignature" }),
    );

    const active = await asApprover<{ id: string; status: string }>("ActivateContract", (tx) =>
      commercial.activateContract(tx, approver, {
        versionId: version.id,
        signedAt: "2026-03-03T18:00:00Z",
        signedByName: "Directora de Operaciones",
        effectiveFrom: "2026-03-05T06:00:00Z",
      }),
    );

    return { contractId: contract.id, versionId: version.id, active };
  };

  /** Sube el formato, enlaza cada marcador y lo publica. */
  const publishContractTemplate = async (mandatory: readonly string[]) => {
    const code = uniqueCode("FORMATO-CTR");

    const template = await run<{ id: string }>("CreateTemplateVersion", "DocumentTemplate", (tx) =>
      createTemplateVersion(tx, {
        code,
        kind: "CONTRACT",
        name: "Contrato de transporte",
        body: CONTRACT_BODY,
        sourceFilename: "contrato-fleeter.html",
      }),
    );

    // El sistema propone un campo por marcador y NO adivina el enlace: quien
    // configura elige de la lista publicada. Aquí se simula esa elección.
    const proposed = proposeFieldsFromBody(CONTRACT_BODY);

    await run("SetTemplateFields", "DocumentTemplate", (tx) =>
      setTemplateFields(
        tx,
        template.id,
        proposed.map((field) => ({
          ...field,
          binding: BINDINGS[field.placeholder] ?? null,
          isMandatory: mandatory.includes(field.placeholder),
        })),
      ),
    );

    await run("PublishTemplate", "DocumentTemplate", (tx) => publishTemplate(tx, template.id));

    return code;
  };

  beforeAll(async () => {
    if (!hasDatabase) return;

    const tenants = await provisionTestTenants();
    alpha = tenants.alpha;
    full = actorFor(alpha);
    approver = actorFor(alpha, undefined, {
      userId: "33333333-3333-4333-8333-333333333333",
    });

    // El RFC del EMISOR es tan obligatorio en un contrato como el del cliente, y
    // hasta ahora solo se podía capturar al provisionar el tenant. Se captura
    // por la misma capacidad que usa la pantalla de configuración.
    await run("UpdateLegalEntity", "LegalEntity", (tx) =>
      updateLegalEntity(tx, {
        legalEntityId: alpha.legalEntityId,
        legalName: "Alpha Logística S.A. de C.V.",
        taxId: "ALO190301XY7",
        timezone: "America/Mexico_City",
      }),
    );

    const customer = await run<{ id: string }>("CreateCustomer", "Customer", (tx) =>
      commercial.createCustomer(tx, full, {
        code: uniqueCode("CLI"),
        legalName: "Comercializadora del Norte S.A. de C.V.",
        taxId: "CNO230815AB1",
        operatingCurrency: "MXN",
        legalEntityId: alpha.legalEntityId,
      }),
    );
    customerId = customer.id;
  });

  afterAll(async () => {
    if (hasDatabase) await closePools();
  });

  it("emite el contrato con los datos capturados y ninguno inventado", async () => {
    const { versionId } = await activeContract({ paymentTermsDays: 30 });
    const code = await publishContractTemplate(Object.keys(BINDINGS));

    const outcome = await run<Awaited<ReturnType<typeof renderTemplate>>>(
      "RenderDocument",
      "DocumentRender",
      (tx) => renderTemplate(tx, { code, subjectId: versionId, subjectType: "ContractVersion" }),
    );

    expect(outcome.status).toBe("rendered");
    const body = outcome.body as string;

    // Cada dato del documento salió de una fila que alguien capturó.
    expect(body).toContain("Comercializadora del Norte S.A. de C.V.");
    expect(body).toContain("CNO230815AB1");
    expect(body).toContain("Alpha Logística S.A. de C.V.");
    expect(body).toContain("Directora de Operaciones");
    expect(body).toContain("30");

    // El bloque repetido trae las dos tarifas pactadas, con su importe exacto.
    expect(body).toContain("FLETE");
    expect(body).toContain("ESTADIA");
    expect(body).toContain("45,000.00");
    expect(body).toContain("350.00");

    // Y no queda ni un marcador sin sustituir.
    expect(body).not.toContain("{{");
  });

  it("bloquea el documento y nombra el dato que falta en lugar de inventarlo", async () => {
    // Mismo formato, mismo contrato, un dato menos: nadie pactó días de crédito.
    const { versionId } = await activeContract({ paymentTermsDays: null });
    const code = await publishContractTemplate(Object.keys(BINDINGS));

    const outcome = await run<Awaited<ReturnType<typeof renderTemplate>>>(
      "RenderDocument",
      "DocumentRender",
      (tx) => renderTemplate(tx, { code, subjectId: versionId, subjectType: "ContractVersion" }),
    );

    expect(outcome.status).toBe("blocked");
    expect(outcome.body).toBeNull();
    expect(outcome.missingFields.map((f) => f.binding)).toEqual([
      "contract.payment_terms_days",
    ]);
    // El faltante se nombra por su marcador, que es lo que quien configuró la
    // plantilla reconoce; no por la columna de la base.
    expect(outcome.missingFields[0]?.placeholder).toBe("dias_credito");
  });

  it("el mismo dato ausente no bloquea si el tenant no lo declaró obligatorio", async () => {
    const { versionId } = await activeContract({ paymentTermsDays: null });
    const optional = Object.keys(BINDINGS).filter((p) => p !== "dias_credito");
    const code = await publishContractTemplate(optional);

    const outcome = await run<Awaited<ReturnType<typeof renderTemplate>>>(
      "RenderDocument",
      "DocumentRender",
      (tx) => renderTemplate(tx, { code, subjectId: versionId, subjectType: "ContractVersion" }),
    );

    // Que sea obligatorio lo decide el tenant en su formato, no el sistema: hay
    // contratos sin plazo de crédito y su documento es válido.
    expect(outcome.status).toBe("rendered");
    expect(outcome.body).not.toContain("{{");
  });

  it("cada marcador solo puede enlazar a un dato que el sistema publica", async () => {
    const paths = new Set(
      (await query<Array<{ path: string }>>("ListBindings", (tx) => listBindings(tx, "CONTRACT"))).map(
        (b) => b.path,
      ),
    );

    for (const binding of Object.values(BINDINGS)) {
      expect(paths.has(binding), `${binding} no está en el catálogo publicado`).toBe(true);
    }

    // Y una ruta que nadie publica no se puede publicar en una plantilla: la
    // frena el trigger de 0019, no una comprobación de la interfaz.
    const template = await run<{ id: string }>("CreateTemplateVersion", "DocumentTemplate", (tx) =>
      createTemplateVersion(tx, {
        code: uniqueCode("FORMATO-MALO"),
        kind: "CONTRACT",
        name: "Formato con un dato que no existe",
        body: "<p>Descuento pactado: {{descuento}}</p>",
      }),
    );

    await run("SetTemplateFields", "DocumentTemplate", (tx) =>
      setTemplateFields(tx, template.id, [
        {
          placeholder: "descuento",
          label: "Descuento",
          binding: "contract.descuento_negociado",
          isMandatory: true,
        },
      ]),
    );

    await expect(
      run("PublishTemplate", "DocumentTemplate", (tx) => publishTemplate(tx, template.id)),
    ).rejects.toThrow(/enlaza a datos que no existen/);
  });

  it("una tabla escrita como dato suelto no se publica", async () => {
    // El tarifario son varias filas. Escrito `{{tarifas}}` el motor imprimía
    // vacío y reportaba el documento como emitido: un contrato firmado con el
    // tarifario en blanco. Ahora se detiene al publicar y dice cómo escribirlo.
    const template = await run<{ id: string }>("CreateTemplateVersion", "DocumentTemplate", (tx) =>
      createTemplateVersion(tx, {
        code: uniqueCode("FORMATO-FORMA"),
        kind: "CONTRACT",
        name: "Formato con el tarifario mal escrito",
        body: "<h2>Tarifario</h2>{{tarifas}}",
      }),
    );

    await run("SetTemplateFields", "DocumentTemplate", (tx) =>
      setTemplateFields(tx, template.id, [
        {
          placeholder: "tarifas",
          label: "Tarifas pactadas",
          binding: "contract.rates",
          isMandatory: true,
        },
      ]),
    );

    await expect(
      run("PublishTemplate", "DocumentTemplate", (tx) => publishTemplate(tx, template.id)),
    ).rejects.toThrow(/forma que no le corresponde/);
  });

  it("poner en vigor exige tarifas, firma y un aprobador distinto del redactor", async () => {
    const contract = await run<{ id: string }>("CreateContract", "Contract", (tx) =>
      commercial.createContract(tx, full, {
        legalEntityId: alpha.legalEntityId,
        customerId,
        code: uniqueCode("CTR"),
        name: "Contrato sin tarifas",
      }),
    );

    const version = await run<{ id: string }>("CreateContractVersion", "ContractVersion", (tx) =>
      commercial.createContractVersion(tx, full, {
        contractId: contract.id,
        currency: "MXN",
      }),
    );

    await run("AdvanceContract", "ContractVersion", (tx) =>
      commercial.advanceContract(tx, full, { versionId: version.id, to: "InReview" }),
    );
    await run("AdvanceContract", "ContractVersion", (tx) =>
      commercial.advanceContract(tx, full, { versionId: version.id, to: "PendingSignature" }),
    );

    // Sin tarifas: un contrato en vigor que no dice a qué precio se pactó nada.
    await expect(
      asApprover("ActivateContract", (tx) =>
        commercial.activateContract(tx, approver, {
          versionId: version.id,
          signedAt: "2026-03-03T18:00:00Z",
          signedByName: "Directora de Operaciones",
          effectiveFrom: "2026-03-05T06:00:00Z",
        }),
      ),
    ).rejects.toThrow(/tarifas/);

    // Y quien la redactó no la activa aunque tenga la facultad.
    await expect(
      run("ActivateContract", "ContractVersion", (tx) =>
        commercial.activateContract(tx, full, {
          versionId: version.id,
          signedAt: "2026-03-03T18:00:00Z",
          signedByName: "Directora de Operaciones",
          effectiveFrom: "2026-03-05T06:00:00Z",
        }),
      ),
    ).rejects.toThrow();
  });

  it("renegociar crea una versión y la anterior conserva lo que se firmó", async () => {
    const { contractId, versionId } = await activeContract({ paymentTermsDays: 30 });

    const renegotiated = await run<{ id: string; version: number }>(
      "CreateContractVersion",
      "ContractVersion",
      (tx) =>
        commercial.createContractVersion(tx, full, {
          contractId,
          currency: "MXN",
          paymentTermsDays: 45,
          rates: [
            {
              chargeCode: "FLETE",
              uom: "viaje",
              unitAmount: "48000.00",
              currency: "MXN",
            },
          ],
        }),
    );

    expect(renegotiated.version).toBe(2);

    const original = await query<{ rates: unknown[]; signedAt: Date | null }>(
      "GetContractVersion",
      (tx) => commercial.getContractVersion(tx, full, versionId),
    );

    // La versión firmada mantiene sus dos tarifas y su firma: el precio pactado
    // el 3 de marzo sigue siendo consultable después de renegociar.
    expect(original.rates).toHaveLength(2);
    expect(original.signedAt).not.toBeNull();
  });

  it("terminar exige motivo y no se puede colar por la transición genérica", async () => {
    const { versionId } = await activeContract({ paymentTermsDays: 30 });

    await expect(
      run("AdvanceContract", "ContractVersion", (tx) =>
        commercial.advanceContract(tx, full, { versionId, to: "Terminated" as never }),
      ),
    ).rejects.toThrow(/terminateContract/);

    const terminated = await run<{ status: string }>("TerminateContract", "ContractVersion", (tx) =>
      commercial.terminateContract(tx, full, {
        versionId,
        reason: "El cliente cerró su operación en la zona.",
      }),
    );

    expect(terminated.status).toBe("Terminated");
  });
});
