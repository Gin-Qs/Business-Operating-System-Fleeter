import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// El entorno vive en la raíz del monorepo: una sola copia de las credenciales
// para la web, las pruebas y el worker de outbox.
config({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se consumen como TypeScript sin paso de compilación.
  transpilePackages: ["@fleeter/contracts", "@fleeter/domain", "@fleeter/platform"],

  // `pg` abre sockets y carga módulos nativos opcionales: se resuelve en tiempo
  // de ejecución en lugar de empaquetarse.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
