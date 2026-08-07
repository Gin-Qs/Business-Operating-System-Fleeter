import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    // Las pruebas de integración comparten una base real: ejecutarlas en un solo
    // proceso evita que se pisen los tenants sembrados entre archivos.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
