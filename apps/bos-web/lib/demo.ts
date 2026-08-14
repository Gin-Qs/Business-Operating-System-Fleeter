/**
 * Acceso demo — una cuenta de administrador tras un solo botón.
 *
 * Conviene ser explícito sobre lo que esto es: una cuenta con permisos de
 * administrador cuya contraseña conoce cualquiera que tenga la URL. En un
 * despliegue público es una puerta abierta, y ninguna cantidad de código lo
 * cambia.
 *
 * Lo que sí se puede hacer es acotar el daño, y eso determina el diseño:
 *
 *   1. **Apagado salvo que se encienda a propósito.** Sin `BOS_DEMO_ACCESS` en
 *      "true" no existe ni el botón ni la acción. No hay valor por defecto que
 *      lo active.
 *   2. **Sin contraseña por defecto.** Si no se configura una, el acceso queda
 *      apagado. Una contraseña "demo1234" horneada en el repositorio sería la
 *      misma puerta abierta, pero además idéntica en todos los despliegues.
 *   3. **La contraseña nunca sale del servidor.** No es `NEXT_PUBLIC_`, así que
 *      no viaja al navegador ni queda en el HTML. El botón envía un formulario
 *      vacío; quien firma con la credencial es el servidor.
 *   4. **Tenant propio.** La cuenta demo administra el tenant `demo` y ningún
 *      otro. Que sea administrador no la acerca a los datos reales: row level
 *      security filtra por tenant y esta cuenta no tiene membresía en el tuyo.
 *
 * La cuarta es la que de verdad importa. Las tres primeras dificultan entrar;
 * la cuarta decide qué se ve al entrar.
 */

export interface DemoAccess {
  email: string;
  password: string;
}

/** Datos del tenant demo. Fijos: es el mismo escaparate en todos lados. */
export const DEMO_TENANT = {
  slug: "demo",
  name: "Fleeter Demo",
  baseCurrency: "MXN",
  timezone: "America/Mexico_City",
  legalEntityCode: "DEMO-MX",
  legalEntityName: "Fleeter Demo S.A. de C.V.",
  country: "MX",
  ownerFullName: "Cuenta de demostración",
} as const;

/**
 * Credenciales del acceso demo, o null si está apagado.
 *
 * Devuelve null —y no lanza— cuando falta configuración: un despliegue sin
 * cuenta demo es el caso normal, no un error.
 */
export function demoAccess(): DemoAccess | null {
  if (process.env.BOS_DEMO_ACCESS !== "true") return null;

  const email = process.env.BOS_DEMO_EMAIL?.trim();
  const password = process.env.BOS_DEMO_PASSWORD ?? "";

  // Supabase exige 6 caracteres como mínimo; por debajo de eso el alta falla y
  // el botón quedaría prometiendo un acceso que nunca funciona.
  if (!email || password.length < 8) return null;

  return { email: email.toLowerCase(), password };
}

export const isDemoEnabled = (): boolean => demoAccess() !== null;
