import { config } from "dotenv";

/**
 * Carga el entorno de pruebas. `.env.local` es opcional: en CI las credenciales
 * llegan como variables del runner, y las pruebas que necesitan base de datos se
 * saltan solas cuando no hay DATABASE_URL.
 */
config({ path: [".env.local", ".env"], quiet: true });
