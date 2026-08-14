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
 *   1. **Una sola variable, y es la contraseña.** `BOS_DEMO_PASSWORD` enciende
 *      el botón; quitarla lo apaga. No hay valor por defecto: una contraseña
 *      "demo1234" horneada en el repositorio sería la misma puerta abierta,
 *      pero además idéntica en todos los despliegues del mundo.
 *   2. **La contraseña nunca sale del servidor.** No es `NEXT_PUBLIC_`, así que
 *      no viaja al navegador ni queda en el HTML. El botón envía un formulario
 *      vacío; quien firma con la credencial es el servidor.
 *   3. **Tenant propio.** La cuenta demo administra el tenant `demo` y ningún
 *      otro. Que sea administrador no la acerca a los datos reales: row level
 *      security filtra por tenant y esta cuenta no tiene membresía en el tuyo.
 *
 * La tercera es la que de verdad importa. Las dos primeras dificultan entrar;
 * la tercera decide qué se ve al entrar.
 *
 * Hubo un interruptor aparte, `BOS_DEMO_ACCESS`, y se quitó: configurar tres
 * variables para "entrar con un botón sin hacer más" contradecía lo que el
 * botón existe para resolver. No se pierde nada, porque nadie define una
 * contraseña de demostración por accidente — poner la variable YA es el acto
 * deliberado que el interruptor pretendía exigir.
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
 * Correo de la cuenta demo cuando nadie configura otro.
 *
 * `example.com` es un dominio reservado (RFC 2606) que nunca entrega correo. Eso
 * es lo que se quiere: la cuenta demo no debe poder recuperar su contraseña ni
 * recibir nada, y un dominio real elegido al azar podría pertenecerle a alguien.
 */
const DEFAULT_DEMO_EMAIL = "demo@example.com";

/**
 * Credenciales del acceso demo, o null si está apagado.
 *
 * Devuelve null —y no lanza— cuando falta la contraseña: un despliegue sin
 * cuenta demo es el caso normal, no un error.
 */
export function demoAccess(): DemoAccess | null {
  const password = process.env.BOS_DEMO_PASSWORD ?? "";

  // Supabase exige 6 caracteres como mínimo; por debajo de eso el alta falla y
  // el botón quedaría prometiendo un acceso que nunca funciona. Se piden 8 para
  // que la contraseña de una cuenta administradora no sea trivial.
  if (password.length < 8) return null;

  const email = process.env.BOS_DEMO_EMAIL?.trim() || DEFAULT_DEMO_EMAIL;

  return { email: email.toLowerCase(), password };
}

export const isDemoEnabled = (): boolean => demoAccess() !== null;
