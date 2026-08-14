"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { grantMembership, provisionTenant, withTenantTransaction } from "@fleeter/platform";
import { completeSignIn, type SignInState } from "./auth";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { demoAccess, DEMO_TENANT } from "../../lib/demo";

/**
 * Entrar con la cuenta de demostración, en un clic.
 *
 * El botón manda un formulario vacío: la credencial vive en el servidor y no
 * viaja al navegador. Quien firma es esta acción.
 *
 * La primera vez el tenant demo todavía no existe, así que la acción lo crea.
 * Eso merece una explicación, porque este código base rechaza el registro
 * abierto a propósito (ver `activateAccount`): ahí cualquiera elige el correo,
 * y aquí el correo es UNO, fijo, definido en el entorno del servidor. No hay
 * entrada del usuario en ninguna parte de este camino — el formulario no lleva
 * campos.
 *
 * A partir del segundo clic todo esto es una consulta que no cambia nada:
 * `provision_tenant` es idempotente por slug y `grant_membership` por rol y
 * alcance.
 */
export async function signInAsDemo(): Promise<SignInState> {
  const demo = demoAccess();

  // Apagado. Se responde lo mismo que ante una credencial mala: si alguien
  // llama la acción directamente, no averigua si la cuenta demo existe.
  if (!demo) {
    return { error: "Credenciales inválidas o cuenta sin acceso." };
  }

  const supabase = await createSupabaseServerClient();

  let attempt = await supabase.auth.signInWithPassword({
    email: demo.email,
    password: demo.password,
  });

  // Primer arranque: la identidad demo todavía no existe en el proveedor.
  if (attempt.error) {
    const created = await supabase.auth.signUp({
      email: demo.email,
      password: demo.password,
    });

    if (created.error) {
      return {
        error:
          "La cuenta demo no se pudo crear. Revisa BOS_DEMO_EMAIL y BOS_DEMO_PASSWORD.",
      };
    }

    attempt = await supabase.auth.signInWithPassword({
      email: demo.email,
      password: demo.password,
    });
  }

  if (attempt.error || !attempt.data.user) {
    // Dos causas, y ninguna se puede distinguir desde aquí sin la API de
    // administración, que este código no usa. Se nombran las dos:
    //
    //   1. Confirmación de correo activada en el proyecto: la identidad quedó
    //      creada pero no puede entrar hasta confirmarse, y nadie va a abrir
    //      ese buzón.
    //   2. BOS_DEMO_PASSWORD cambió sin cambiarla también en Supabase. Rotarla
    //      son dos pasos; con uno solo el botón deja de funcionar y la
    //      contraseña vieja sigue sirviendo por el formulario.
    return {
      error:
        "La cuenta demo existe pero no pudo iniciar sesión. O el proyecto exige confirmar " +
        "el correo, o BOS_DEMO_PASSWORD ya no coincide con la contraseña que tiene esa " +
        "identidad en Supabase.",
    };
  }

  const user = attempt.data.user;

  // El tenant demo es SUYO y de nadie más. Ser administrador aquí no acerca a
  // los datos de ningún otro tenant: row level security filtra por membresía, y
  // esta cuenta no tiene ninguna fuera de `demo`.
  const tenant = await provisionTenant({
    slug: DEMO_TENANT.slug,
    name: DEMO_TENANT.name,
    baseCurrency: DEMO_TENANT.baseCurrency,
    timezone: DEMO_TENANT.timezone,
    legalEntityCode: DEMO_TENANT.legalEntityCode,
    legalEntityName: DEMO_TENANT.legalEntityName,
    country: DEMO_TENANT.country,
    ownerUserId: user.id,
    ownerEmail: demo.email,
    ownerFullName: DEMO_TENANT.ownerFullName,
  });

  // Reentrada: si el tenant ya existía por otra identidad —un despliegue previo
  // con otro correo demo—, `provision_tenant` devuelve el tenant sin conceder
  // nada. Sin esto, el botón entraría a un espacio de trabajo vacío y sin
  // permisos, que es peor que no entrar.
  await withTenantTransaction(
    {
      tenantId: tenant.tenantId,
      actorType: "service",
      actorId: null,
      legalEntityId: tenant.legalEntityId,
      correlationId: randomUUID(),
    },
    (tx) =>
      grantMembership(tx, {
        userId: user.id,
        email: demo.email,
        fullName: DEMO_TENANT.ownerFullName,
        roleCode: "tenant_admin",
      }),
  );

  // Mismo cierre que el formulario: redimir invitaciones, resolver membresía y
  // dejar el acceso en la auditoría. Un acceso demo se audita como cualquier
  // otro; que la cuenta sea de exhibición no la exime de dejar rastro.
  const failure = await completeSignIn(user.id, demo.email);
  if (failure) return { error: failure };

  redirect("/workspace");
}
