"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { listMemberships, recordAudit, withTenantTransaction } from "@fleeter/platform";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export interface SignInState {
  error?: string;
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

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
