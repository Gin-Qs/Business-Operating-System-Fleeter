"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import {
  hasPendingInvitation,
  listMemberships,
  recordAudit,
  redeemInvitations,
  withTenantTransaction,
} from "@fleeter/platform";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export interface SignInState {
  error?: string;
}

export interface ActivationState {
  error?: string;
  notice?: string;
}

/**
 * Inicio de sesión.
 *
 * El mensaje de error es deliberadamente el mismo para credenciales inválidas y
 * para una identidad sin membresía: distinguirlos revelaría qué correos existen
 * en el sistema y en qué tenants.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (email === "" || password === "") {
    return { error: "Ingresa tu correo y contraseña." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Credenciales inválidas o cuenta sin acceso." };
  }

  // Antes de resolver el tenant: quien fue invitado todavía no tiene ninguna
  // membresía, y sin esto vería el mismo "cuenta sin acceso" que alguien a
  // quien nadie invitó. Es idempotente, así que correrlo en cada acceso solo
  // cuesta una consulta.
  await redeemInvitations(data.user.id, data.user.email ?? email);

  const memberships = await listMemberships(data.user.id);
  if (memberships.length === 0) {
    await supabase.auth.signOut();
    return { error: "Credenciales inválidas o cuenta sin acceso." };
  }

  // docs/00 §9: el acceso es una acción sensible y deja rastro con actor y
  // correlación, igual que cualquier cambio de estado.
  const membership = memberships[0]!;
  await withTenantTransaction(
    {
      tenantId: membership.tenantId,
      actorType: "user",
      actorId: data.user.id,
      legalEntityId: membership.legalEntityId,
      correlationId: randomUUID(),
    },
    (tx) =>
      recordAudit(tx, {
        action: "UserSignedIn",
        entityType: "UserAccount",
        entityId: data.user.id,
        after: { role_code: membership.roleCode, tenant_slug: membership.tenantSlug },
      }),
  );

  redirect("/workspace");
}

/**
 * Activación de cuenta.
 *
 * Cierra el ciclo que hace operable un tenant nuevo: el administrador invita un
 * correo, y esa persona crea aquí su credencial. Sin esto, dar de alta a alguien
 * exigiría entrar a la consola del proveedor de identidad, que es justo lo que
 * un producto no debería pedirle a su administrador.
 *
 * **Solo se puede activar con invitación viva.** El registro abierto crearía
 * identidades sin acceso a nada —inofensivas, pero ruido— y convertiría el
 * portal en un formulario público.
 *
 * La respuesta es la misma exista o no la invitación, y exista o no ya la
 * cuenta. Distinguir los casos convertiría esta pantalla en un oráculo para
 * averiguar quién trabaja dónde.
 */
const ACTIVATION_NOTICE =
  "Si tu correo tiene una invitación vigente, tu acceso quedó listo. " +
  "Si el proveedor de identidad pide confirmación, revisa tu bandeja antes de ingresar.";

export async function activateAccount(
  _prev: ActivationState,
  formData: FormData,
): Promise<ActivationState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (email === "" || password.length < 8) {
    return { error: "Ingresa tu correo y una contraseña de al menos 8 caracteres." };
  }

  if (!(await hasPendingInvitation(email))) {
    return { notice: ACTIVATION_NOTICE };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    return { notice: ACTIVATION_NOTICE };
  }

  // Con confirmación de correo activada no hay sesión todavía; la invitación se
  // redime en el primer inicio de sesión, que también la procesa.
  if (data.session) {
    await redeemInvitations(data.user.id, email);
  }

  return { notice: ACTIVATION_NOTICE };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
