import { redirect } from "next/navigation";
import { buildSession, listMemberships, type ResolvedSession } from "@fleeter/platform";
import { getAuthenticatedUser } from "./supabase/server";

/**
 * Sesión del BOS: identidad autenticada + membresía resuelta.
 *
 * Estar autenticado no basta para entrar. Una identidad sin membresía activa no
 * tiene tenant, y sin tenant no hay nada que pueda ver (ADR-003).
 */

export type BosSession = ResolvedSession & { userId: string; email: string };

export async function getSession(requestedTenantId?: string): Promise<BosSession | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) return null;

  return {
    ...buildSession(user.id, memberships, requestedTenantId),
    userId: user.id,
    email: user.email ?? "",
  };
}

/** Para páginas que exigen sesión: redirige al portal si no la hay. */
export async function requireSession(requestedTenantId?: string): Promise<BosSession> {
  const session = await getSession(requestedTenantId);
  if (!session) redirect("/?error=session_required");
  return session;
}
