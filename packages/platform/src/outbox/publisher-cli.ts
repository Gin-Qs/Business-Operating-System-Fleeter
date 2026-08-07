import { closePools } from "../db/pool";
import { loggingHandler, publishPendingEvents } from "./publisher";

/**
 * Worker de outbox — deployment unit 3 de docs/11 §3.
 *
 * Se ejecuta como proceso aparte del servidor web precisamente porque su
 * patrón de carga y su modo de falla son distintos: un tercero lento no debe
 * consumir las conexiones que atienden usuarios.
 *
 *   npm run outbox:publish            una pasada y termina
 *   npm run outbox:publish -- --loop  ciclo continuo
 */

const LOOP = process.argv.includes("--loop");
const IDLE_MS = Number(process.env.OUTBOX_IDLE_MS ?? 2000);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Se termina el lote en curso antes de salir: interrumpirlo dejaría eventos
    // en `publishing` esperando a que el backoff los rescate.
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  do {
    const summary = await publishPendingEvents({ handlers: [loggingHandler] });

    if (summary.claimed > 0 || !LOOP) {
      console.log(JSON.stringify({ level: "info", message: "outbox.batch", ...summary }));
    }
    if (summary.deadLettered > 0) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "outbox.dead_letter",
          count: summary.deadLettered,
          action: "Revisar plt.outbox where status = 'failed' y ejecutar replay autorizado",
        }),
      );
    }

    if (LOOP && !stopping && summary.claimed === 0) {
      await sleep(IDLE_MS);
    }
  } while (LOOP && !stopping);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closePools();
}
